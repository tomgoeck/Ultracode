import React from 'react'
import ReactDOM from 'react-dom/client'

function App() {
  return (
    <main>
      <h1>Testwebsite</h1>
      <p>Willkommen auf der Testseite.</p>
    </main>
  )
}

const root = ReactDOM.createRoot(document.getElementById('root'))
root.render(<App />)