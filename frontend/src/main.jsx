import React from 'react'
import ReactDOM from 'react-dom/client'

import './styles.css'

import App from './App.jsx'
import DatasetBootstrap from './components/DatasetBootstrap.jsx'


const rootElement = document.getElementById(
  'root',
)


ReactDOM.createRoot(
  rootElement,
).render(
  <React.StrictMode>
    <DatasetBootstrap>
      <App />
    </DatasetBootstrap>
  </React.StrictMode>,
)
