// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import { KiteConnect } from '../../lib/kiteconnect'

import withSession from '../../lib/session'

const kc = new KiteConnect({
  api_key: process.env.KITE_API_KEY
})

export default withSession(async (req, res) => {
  const user = req.session.get('user')

  if (!user) {
    const url = process.env.KITE_API_KEY === 'kiteandroid' ? '/login' : kc.getLoginURL()
    return res.redirect(url)
  }

  return res.redirect('/dashboard')
})
