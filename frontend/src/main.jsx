import React from 'react'
import ReactDOM from 'react-dom/client'

import './styles.css'

import App from './App.jsx'
import DatasetBootstrap from './components/DatasetBootstrap.jsx'
import { RallyBallDataProvider } from './utils/useRallyBallData.js'


const rootElement = document.getElementById(
  'root',
)


ReactDOM.createRoot(
  rootElement,
).render(
  <React.StrictMode>
    <DatasetBootstrap>
      <RallyBallDataProvider>
        <App />
      </RallyBallDataProvider>
    </DatasetBootstrap>
  </React.StrictMode>,
)
