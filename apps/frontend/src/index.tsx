import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

import { store } from './redux/store';

import ErrorBoundary from './components/ErrorBoundary';
import App from './App';

const container = document.getElementById('root')!;
const root = createRoot(container);

root.render(
  // <React.StrictMode>
  <Provider store={store}>
    <ErrorBoundary>
      <BrowserRouter>
        <DndProvider backend={HTML5Backend}>
          <App />
        </DndProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </Provider>,
  // </React.StrictMode>,
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
// reportWebVitals();
