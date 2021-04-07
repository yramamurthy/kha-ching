import withSession from '../../lib/session';
import { syncGetKiteInstance } from '../../lib/utils';

export default withSession(async (req, res) => {
  const user = req.session.get('user');

  if (!user) {
    return res.status(401).send('Unauthorized');
  }

  const { tradingsymbol, quantity } = req.query;
  const kite = syncGetKiteInstance(user);

  const allOrders = await kite.getOrders();
  const openOrders = allOrders.filter((order) => order.status === 'OPEN');
  const orders = [{ tradingsymbol, exchange: 'NFO', quantity, product: 'MIS' }];
  const openOrdersForPositions = orders
    .map((order) =>
      openOrders.find(
        (openOrder) =>
          openOrder.product === order.product &&
          openOrder.exchange === order.exchange &&
          openOrder.tradingsymbol === order.tradingsymbol &&
          // reverse trade on same exchange + tradingsybol is not possible,
          // so doing `abs`
          Math.abs(openOrder.quantity) === Math.abs(order.quantity)
      )
    )
    .filter((o) => o);

  // some positions might have squared off during the day when the SL hit
  try {
    await Promise.all(
      openOrdersForPositions.map((openOrder) =>
        kite.cancelOrder(openOrder.variety, openOrder.order_id)
      )
    );
    res.json({ allOrders, openOrdersForPositions });
  } catch (e) {
    res.status(500).send(e);
  }
});
