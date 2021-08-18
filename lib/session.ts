// this file is a wrapper with defaults to be used in both API routes and `getServerSideProps` functions
import { withIronSession } from 'next-iron-session'
import { KiteConnect } from 'kiteconnect'
// NB: not the best place to require these
// ideally these should live in their own file that gets included as a middleware
require('./queue-processor')
require('./exit-strategies')
require('./watchers')

const withAdminCheck = (handler) => {
  return async function withAdminWrapper(req, res) {
    const kiteKey = req.headers['signalx-kite-key'];
    const kiteToken = req.headers['signalx-kite-token'];
    if (kiteKey && kiteToken) {
      console.log('key and token found in headers. ateempting to connect kite and save session')
      try {
        const kc = new KiteConnect({
          api_key: kiteKey,
          access_token: kiteToken
        });

        const kiteProfile = await kc.getProfile();
        const user = { isLoggedIn: true, session: { access_token: kiteToken, ...kiteProfile } }
        req.session.set('user', user)
        await req.session.save()
        console.log('session generated')
      } catch (error) {
        console.log(error)
        return res.status(403).send('Forbidden. Unauthorized kry or token provided')
      }
    }
    return handler(req, res)
  }
}

export default function withSession(handler) {
  return withIronSession(withAdminCheck(handler), {
    password: process.env.SECRET_COOKIE_PASSWORD!,
    cookieName: 'khaching/kite/session',
    cookieOptions: {
      // the next line allows to use the session in non-https environments like
      // Next.js dev mode (http://localhost:3000)
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1 * 24 * 60 * 60 // 1 day
    }
  })
}
