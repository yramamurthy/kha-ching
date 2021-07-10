import console from '../logging';
import { useKiteTicker } from '../socket/ticker';
import { getCurrentExpiryTradingSymbol, getIndexInstruments, syncGetKiteInstance } from '../utils';
const apiKey = process.env.KITE_API_KEY;

import {
  getAllOrNoneCompletedOrdersByKiteResponse,
  getInstrumentPrice,
  getPercentageChange
} from '../utils';
import { doSquareOffPositions } from './autoSquareOff';

export default async ({ type = 'BUY', initialJobData, rawKiteOrdersResponse }) => {
  const { slmPercent, user, orderTag } = initialJobData;
  const kite = syncGetKiteInstance(user);

  const legsOrders = await getAllOrNoneCompletedOrdersByKiteResponse(kite, rawKiteOrdersResponse);
  if (!legsOrders) {
    console.log('🔴 Initial order not punched on Zerodha!');
    return Promise.reject('Initial order not completed yet! Waiting for `Completed` order type...');
  }

  const initialPremiumSold = legsOrders.reduce((sum, order) => sum + order.average_price, 0);

  const tradingSymbols = legsOrders.map((order) => order.tradingsymbol);
  const indexInstruments = getIndexInstruments();
  const instrumentTokens = tradingSymbols.map(
    (symbol) =>
      getCurrentExpiryTradingSymbol({
        sourceData: indexInstruments,
        tradingsymbol: symbol
      })?.instrument_token
  );

  const ticker = useKiteTicker({
    tickerId: orderTag,
    apiKey,
    accessToken: user.session.access_token,
    onConnect: () => subscribeInstruments(),
    onTicks: () => onInstrumentTicks()
    // onDisconnect: (e) => updateStatus('disconnect', e),
    // onError: (e) => updateStatus('closed_with_error', e),
    // onClose: () => updateStatus('clean_close'),
    // onReconnect: (...args) => updateStatus('reconnect', ...args),
    // onNoReconnect: () => updateStatus('noreconnect')
  });

  const subscribeInstruments = () => {
    ticker.subscribe(instrumentTokens);
    ticker.setMode(ticker.modeFull, instrumentTokens);
  };

  const onInstrumentTicks = (ticksData) => {
    const currentTotalPremium = ticksData.reduce(
      (combinedPremium, tickData) => combinedPremium + tickData.last_price,
      0
    );

    const changeInPremiumPercentage =
      ((currentTotalPremium - initialPremiumSold) / initialPremiumSold) * 100;

    if (changeInPremiumPercentage > slmPercent) {
      // close ticker connection
      ticker.disconnect();
      doSquareOffPositions(rawKiteOrdersResponse, kite, initialJobData);
    }
  };

  const openPositions = await kite.getPositions();

  const { net } = openPositions;
  const netPositionsForLegs = legsOrders
    .reduce((accum, order) => {
      const { tradingsymbol, quantity, product } = order;
      const openPositionForLeg = net.find(
        (position) =>
          position.product === product &&
          Math.abs(position.quantity) >= Math.abs(quantity) &&
          position.tradingsymbol === tradingsymbol
      );
      return [...accum, openPositionForLeg];
    }, [])
    .filter((o) => o);

  if (netPositionsForLegs.length !== legsOrders.length) {
    return Promise.resolve('Open position not found! Terminating checker...');
  }

  const averageOrderPrices = legsOrders.map((order) => order.average_price);
  const initialPremiumReceived = averageOrderPrices.reduce((sum, price) => sum + price, 0);

  try {
    // [TODO] check for bid value here instead of LTP
    // makes more sense for illiquid underlying
    const liveSymbolPrices = await Promise.all(
      tradingSymbols.map((symbol) => getInstrumentPrice(kite, symbol, kite.EXCHANGE_NFO))
    );

    const liveTotalPremium = liveSymbolPrices.reduce((sum, price) => sum + price, 0);
    const deltaInCombinedPremiumPercent = Math.round(
      getPercentageChange(initialPremiumReceived, liveTotalPremium)
    );

    if (deltaInCombinedPremiumPercent < slmPercent) {
      const rejectMsg = `[multiLegPremiumThreshold] combined delta (${deltaInCombinedPremiumPercent}%) < threshold (${slmPercent}%)`;
      console.log(rejectMsg);
      return Promise.reject(rejectMsg);
    }

    const exitMsg = `☢️ [multiLegPremiumThreshold] triggered! combined delta (${deltaInCombinedPremiumPercent}%) > threshold (${slmPercent}%)`;
    console.log(exitMsg);

    const exitOrders = legsOrders.map((order) => {
      const exitOrder = {
        tradingsymbol: order.tradingsymbol,
        quantity: order.quantity,
        exchange: order.exchange,
        transaction_type: type === 'BUY' ? kite.TRANSACTION_TYPE_BUY : kite.TRANSACTION_TYPE_SELL,
        order_type: kite.ORDER_TYPE_MARKET,
        product: kite.PRODUCT_MIS,
        validity: kite.VALIDITY_DAY,
        tag: orderTag
      };

      console.log('placing exit order at market price...', exitOrder);
      return kite.placeOrder(kite.VARIETY_REGULAR, exitOrder);
    });

    try {
      const response = await Promise.all(exitOrders);
      console.log(response);
      return Promise.resolve(response);
    } catch (e) {
      // NB: this could be disastrous although I don't know why it'd fail!
      console.log('exit orders failed!!', e);
      return Promise.reject(e);
    }
  } catch (e) {
    return Promise.reject(e);
  }
};
