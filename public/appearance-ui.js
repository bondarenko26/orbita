const themes = {dark: 'Тёмная', light: 'Светлая', violet: 'Сумерки'};
const fonts = {system: 'Системный', sans: 'Без засечек (Arial)', serif: 'С засечками (Georgia)', mono: 'Моноширинный'};
const sizes = {compact: 'Компактный', normal: 'Обычный', large: 'Крупный', larger: 'Очень крупный'};
const accents = {dark: '#83dfd1', light: '#234fa3', violet: '#ffc7ae'};
// The lightest dark surface or darkest light surface in each theme.
const surfaces = {dark: '#203040', light: '#e3edf7', violet: '#3a2e49'};
const textColors = {dark: '#eff5f6', light: '#182c42', violet: '#fff0ee'};
const defaults = {theme: 'dark', font: 'system', text_size: 'normal', accent: 'auto', text_color: 'auto'};

function channels(hex) {
  return hex.slice(1).match(/../g).map(pair => parseInt(pair, 16));
}

function luminance(rgb) {
  const linear = rgb.map(value => {
    const fraction = value / 255;
    return fraction <= 0.04045 ? fraction / 12.92 : ((fraction + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function readableColor(hex, theme) {
  const background = luminance(channels(surfaces[theme]));
  const source = channels(hex);
  const target = theme === 'light' ? 0 : 255;
  for (let step = 0; step <= 100; step++) {
    const rgb = source.map(value => Math.round(value + (target - value) * step / 100));
    const foreground = luminance(rgb);
    if ((Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) >= 4.5) {
      return 'rgb(' + rgb.join(', ') + ')';
    }
  }
}

export function applyAppearance(preferences = defaults) {
  const {theme, font, text_size, accent, text_color} = {...defaults, ...preferences};
  const body = document.body;
  body.dataset.theme = theme;
  body.dataset.font = font;
  document.documentElement.dataset.textSize = text_size;
  if (accent !== 'auto') {
    body.style.setProperty('--personal-accent', readableColor(accent, theme));
    body.dataset.customAccent = 'yes';
  } else {
    body.style.removeProperty('--personal-accent');
    delete body.dataset.customAccent;
  }
  if (text_color === 'auto') body.style.removeProperty('--ink');
  else body.style.setProperty('--ink', readableColor(text_color, theme));
}

function options(choices, selected) {
  return Object.entries(choices).map(([value, label]) =>
    `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}

export function appearanceView(user) {
  const saved = {...defaults, ...user};
  const automatic = saved.accent === 'auto';
  const automaticText = saved.text_color === 'auto';
  return `<h1>Оформление</h1>
  <form class="appearance-form" data-appearance>
    <fieldset class="card appearance-fields">
      <legend class="visually-hidden">Настройки оформления</legend>
      <fieldset class="theme-choices"><legend>Тема</legend><div class="theme-samples">
        ${Object.entries(themes).map(([id,name]) => `<label class="theme-choice">
          <input class="visually-hidden" type="radio" name="theme" value="${id}" ${saved.theme===id?'checked':''}>
          <span class="theme-sample" data-palette="${id}" aria-hidden="true"><span class="sample-week"><i></i><i></i><i></i><i></i><i></i></span><span class="sample-lesson"></span></span>
          <span class="sample-name">${name}<b aria-hidden="true">✓</b></span></label>`).join('')}
      </div></fieldset>
      <div><label for="appearance-font">Шрифт</label><select id="appearance-font" name="font">${options(fonts, saved.font)}</select></div>
      <div><label for="appearance-size">Размер текста</label><select id="appearance-size" name="text_size">${options(sizes, saved.text_size)}</select></div>
      <div class="accent-setting"><label for="appearance-accent">Акцентный цвет</label><select id="appearance-accent" name="colorMode">${options({auto:'Цвет темы',custom:'Свой цвет'},automatic?'auto':'custom')}</select>
        <label data-custom-color ${automatic?'hidden':''}>Выбрать оттенок<input type="color" name="color" value="${automatic?accents[saved.theme]:saved.accent}"></label></div>
      <div class="accent-setting"><label for="appearance-ink">Цвет текста</label><select id="appearance-ink" name="inkMode">${options({auto:'Цвет темы',custom:'Свой цвет'},automaticText?'auto':'custom')}</select>
        <label data-custom-ink ${automaticText?'hidden':''}>Оттенок текста<input type="color" name="ink" value="${automaticText?textColors[saved.theme]:saved.text_color}"></label></div>
    </fieldset>
    <section class="card appearance-preview" aria-label="Предпросмотр">
      <span class="eyebrow">Предпросмотр</span><h2>Следующее занятие</h2><p>Понедельник · 10:00</p>
      <span class="preview-accent">Лекция</span>
    </section>
    <div class="appearance-actions"><button class="primary" type="submit">Сохранить</button><button type="button" data-default-appearance>Сбросить к стандартным</button></div>
    <p class="error" role="alert"></p>
  </form>`;
}

export function bindAppearance(form, save) {
  const fields = form.elements;
  const custom = form.querySelector('[data-custom-color]');
  const customInk = form.querySelector('[data-custom-ink]');
  const error = form.querySelector('.error');
  function preview() {
    const automatic = fields.colorMode.value === 'auto';
    custom.hidden = automatic;
    if (automatic) fields.color.value = accents[fields.theme.value];
    const automaticText = fields.inkMode.value === 'auto';
    customInk.hidden = automaticText;
    if (automaticText) fields.ink.value = textColors[fields.theme.value];
    const values = {theme: fields.theme.value, font: fields.font.value, text_size: fields.text_size.value,
      accent: automatic ? 'auto' : fields.color.value, text_color: automaticText ? 'auto' : fields.ink.value};
    applyAppearance(values);
    return values;
  }
  form.addEventListener('input', preview);
  form.addEventListener('change', preview);
  form.querySelector('[data-default-appearance]').onclick = () => {
    fields.theme.value = defaults.theme;
    fields.font.value = defaults.font;
    fields.text_size.value = defaults.text_size;
    fields.colorMode.value = 'auto';
    fields.inkMode.value = 'auto';
    preview();
  };
  form.onsubmit = async event => {
    event.preventDefault();
    const submit = form.querySelector('[type=submit]');
    if (submit.disabled) return;
    const values = preview();
    const controls = [form.querySelector('fieldset'), submit, form.querySelector('[data-default-appearance]')];
    controls.forEach(el => el.disabled = true);
    error.textContent = '';
    try { await save(values); }
    catch (err) { error.textContent = err.message; }
    finally { controls.forEach(el => el.disabled = false); }
  };
}
