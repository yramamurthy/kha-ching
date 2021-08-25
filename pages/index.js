import useUser from '../lib/useUser'
import styles from '../styles/Home.module.css'

export default function Home () {
  useUser({ redirectTo: '/dashboard', redirectIfFound: true })

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        {/* eslint-disable */}
        <img src='/logo.png' width='300' alt='SignalX' />

        <p className={styles.description}>
          Welcome to the algo trading world!<br></br>
          <a href='/api/login'>Continue with Kite</a>
        </p>
      </main>
    </div>
  )
}
