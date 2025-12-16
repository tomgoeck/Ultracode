```javascript
import React from 'react';
import ReactDOM from 'react-dom/client';

function App() {
  return (
    <main>
      <h1>Willkommen auf der Einhorn-Website!</h1>
      <p>Hier findest du alle Infos und Geschichten über Einhörner.</p>
    </main>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
```