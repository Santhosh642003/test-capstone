import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

const addScript = (src) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    document.head.appendChild(script);
};

const addStylesheet = (href) => {
    const link = document.createElement('link');
    link.href = href;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
};

addScript('https://cdn.form.io/formiojs/formio.full.min.js');
addStylesheet('https://cdn.form.io/formiojs/formio.full.min.css');

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root')
);
// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
