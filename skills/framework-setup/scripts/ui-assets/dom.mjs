/** Every dynamic value enters as text, including owner messages and file paths. */
export const element = (tag, text = null, className = null) => {
  const node = document.createElement(tag);
  if (text !== null && text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
};
export const append = (parent, ...children) => { parent.append(...children.filter(Boolean)); return parent; };
export const button = (label, action, kind = 'secondary') => {
  const node = element('button', label, `button ${kind}`);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
};
export const card = (title, description) => {
  const node = element('section', null, 'card');
  append(node, element('h2', title), description ? element('p', description, 'muted') : null);
  return node;
};
export const chip = (value) => {
  const good = ['healthy', 'activated', 'passed', 'completed', 'ready', 'succeeded'].includes(value);
  const bad = ['broken', 'failed', 'refused', 'recovery-required', 'unrunnable'].includes(value);
  return element('span', value ?? 'Not reported', `chip ${good ? 'good' : bad ? 'bad' : 'warning'}`);
};
export const pairs = (values) => {
  const node = element('dl', null, 'details-list');
  for (const [label, value] of Object.entries(values)) append(node, element('dt', label), element('dd', typeof value === 'object' && value !== null ? JSON.stringify(value) : value ?? 'Not reported'));
  return node;
};
export const details = (value, label = 'Advanced: structured result') => append(element('details'), element('summary', label), element('pre', JSON.stringify(value, null, 2)));
export const notice = (text, error = false) => element('p', text, `notice${error ? ' error' : ''}`);
export const table = (caption, columns, rows) => {
  const wrapper = element('div', null, 'table-wrap');
  wrapper.tabIndex = 0;
  wrapper.setAttribute('role', 'region');
  wrapper.setAttribute('aria-label', `${caption} table; scroll horizontally if needed`);
  const node = element('table');
  const heading = element('tr');
  for (const label of columns) { const th = element('th', label); th.scope = 'col'; heading.append(th); }
  const body = element('tbody');
  for (const row of rows) { const tr = element('tr'); for (const value of row) tr.append(element('td', value ?? '—')); body.append(tr); }
  append(node, element('caption', caption), append(element('thead'), heading), body);
  return append(wrapper, node);
};
