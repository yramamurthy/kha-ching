import { AxiosResponse } from 'axios'
import { KiteConnect } from '../../lib/kiteconnect'
import { cleanupQueues } from '../../lib/queue'

import withSession from '../../lib/session'
import { getIndexInstruments, premiumAuthCheck, storeAccessTokenRemotely, checkHasSameAccessToken } from '../../lib/utils'
import { KiteProfile } from '../../types/kite'
import { SignalXUser } from '../../types/misc'

const apiKey = process.env.KITE_API_KEY
const kiteSecret = process.env.KITE_API_SECRET

const kiteUser = process.env.KITE_USER
const kitePassword = process.env.KITE_PASSWORD
const kitePIN = process.env.KITE_PIN

const kc = new KiteConnect({
  api_key: apiKey
})

export default withSession(async (req, res) => {
  const { request_token: requestToken, user_id: userId, password: password, pin: pin } = req.query

  if (!requestToken || userId !== kiteUser || pin !== kitePIN) {
    return res.status(401).send(`<body><center><h3>Unauthorized.</h3><a href='/'>Goto homepage</a></center></body>`)
  }

  try {
    let sessionData: KiteProfile
    if (requestToken !== apiKey) {
      sessionData = await kc.generateSession(requestToken, kiteSecret)
    } else {
      sessionData = await kc.createSession(userId, password, pin)
    }
    const user: SignalXUser = { isLoggedIn: true, session: sessionData }
    req.session.set('user', user)
    await req.session.save()

    // prepare the day
    // fire and forget
    premiumAuthCheck().catch((e) => {
      console.log(e)
    })
    getIndexInstruments().catch((e) => {
      console.log(e)
    })

    const existingAccessToken = await checkHasSameAccessToken(user.session.access_token!)
    if (!existingAccessToken) {
      // first login, or revoked login
      // cleanup queue in both cases
      console.log('cleaning up queues...')
      cleanupQueues().catch(e => {
        console.log(e)
      })
      // then store access token remotely for other services to use it
      storeAccessTokenRemotely(user.session.access_token)
    }

    // then redirect
    res.redirect('/dashboard')
  } catch (error) {
    const { response: fetchResponse } = error
    res.status(fetchResponse?.status || 500).json(error.data)
  }
})
