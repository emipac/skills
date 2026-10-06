import { append, button, element, notice } from './dom.mjs';

const title = (name) => name.replace(/([A-Z])/g, ' $1').replaceAll('-', ' ').replace(/^./, (letter) => letter.toUpperCase());

/** Forms follow owner metadata; they introduce no configuration defaults. */
export const operationForm = ({ descriptor, initial = {}, submit, draft }) => {
  const form = element('form', null, 'form-width');
  const controls = new Map();
  for (const [name, field] of Object.entries(descriptor.fields)) {
    const wrapper = element('div', null, 'field');
    const id = `field-${name}`;
    const label = element('label', `${title(name)}${field.required ? ' (required)' : ''}`);
    label.htmlFor = id;
    let control;
    if (field.options) {
      control = element('select');
      const empty = element('option', field.required ? 'Choose an option' : 'Use the discovered default');
      empty.value = '';
      control.append(empty);
      for (const value of field.options) { const option = element('option', value); option.value = value; control.append(option); }
    } else if (['object', 'strings'].includes(field.type)) {
      control = element('textarea');
      control.rows = field.type === 'object' ? 12 : 4;
    } else {
      control = element('input');
      control.type = field.type === 'boolean' ? 'checkbox' : field.type === 'integer' ? 'number' : 'text';
      if (field.type === 'integer') control.step = '1';
    }
    control.id = id;
    control.name = name;
    control.required = field.required === true;
    if (field.type === 'boolean') control.checked = initial[name] === true;
    else if (initial[name] !== undefined) control.value = field.type === 'object' ? JSON.stringify(initial[name], null, 2) : field.type === 'strings' ? initial[name].join('\n') : String(initial[name]);
    const hint = element('p', `${field.description}${field.type === 'strings' ? ' Enter one item per line.' : field.type === 'object' ? ' Load the owner’s draft, then edit only unresolved decisions. This is JSON, not YAML.' : ''}`, 'hint');
    hint.id = `${id}-hint`;
    control.setAttribute('aria-describedby', hint.id);
    append(wrapper, field.type === 'boolean' ? control : label, field.type === 'boolean' ? label : control, hint);
    if (field.type === 'object' && draft) append(wrapper, button('Load owner’s draft', () => draft(name, control)));
    form.append(wrapper);
    controls.set(name, { control, field });
  }
  const errors = element('p', null, 'form-error');
  errors.setAttribute('role', 'alert');
  errors.tabIndex = -1;
  const run = element('button', descriptor.previewable ? 'Preview this operation' : 'Run operation', 'button primary');
  run.type = 'submit';
  append(form, errors, run);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errors.textContent = '';
    const fields = {};
    try {
      for (const [name, { control, field }] of controls) {
        if (field.type === 'boolean') { if (control.checked) fields[name] = true; continue; }
        const text = control.value.trim();
        if (!text && !field.required) continue;
        if (field.type === 'object') {
          const value = JSON.parse(text);
          if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(`${title(name)} must be a JSON object.`);
          fields[name] = value;
        } else if (field.type === 'strings') fields[name] = text.split('\n').map((item) => item.trim()).filter(Boolean);
        else if (field.type === 'integer') fields[name] = Number(text);
        else fields[name] = text;
      }
      run.disabled = true;
      await submit(fields);
    } catch (error) {
      errors.textContent = error instanceof SyntaxError ? 'The JSON is not valid. Check commas, quotes and braces, then preview again.' : error.message;
      errors.focus();
    } finally { run.disabled = false; }
  });
  if (descriptor.previewable) form.prepend(notice('This first step previews the operation. Review its result, then choose whether to confirm it.'));
  return form;
};
