import console from '../logging';
import { useKiteTicker } from '../socket/ticker';
import { getCurrentExpiryTradingSymbol, getIndexInstruments, syncGetKiteInstance } from '../utils';
const apiKey = process.env.KITE_API_KEY;

import { getAllOrNoneCompletedOrdersByKiteResponse } from '../utils';
import { doSquareOffPositions } from './autoSquareOff';

export default async ({ initialJobData, rawKiteOrdersResponse }) => {
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
      // square off positions
      doSquareOffPositions(rawKiteOrdersResponse, kite, initialJobData);
      // close ticker connection
      ticker.disconnect();

      // resolve the queue task?!
    }
  };

  // concerns - if we were to resolve the queue right here,
  // and then the node process were to get killed or restarted,
  // there's no way we can restart this processor

  // unless you build a DB level bootup method
};
