import {register} from 'node:module';

function element() {
 return {
  classList: {toggle() {}, add() {}, remove() {}, contains() { return false; }},
  addEventListener() {},
  removeEventListener() {},
  setAttribute() {},
  append() {},
  after() {},
  replaceChildren() {},
  style: {},
  dataset: {},
  value: '',
  textContent: '',
  disabled: false
 };
}

if (typeof globalThis.document === 'undefined') {
 globalThis.document = {
  getElementById() { return null; },
  createElement: element,
  createTextNode(text) { return {textContent: text}; },
  addEventListener() {},
  querySelectorAll() { return []; },
  readyState: 'complete',
  head: element()
 };
}

register('./hooks.mjs', import.meta.url);
