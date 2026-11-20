const normalize = value => value.trim().toLocaleLowerCase('ru').replaceAll('ё','е');

export function registerTeacherPicker(directory) {
 class TeacherPicker extends HTMLElement {
  connectedCallback() {
   if (this.input) return;
   this.input = this.querySelector('[role=combobox]');
   this.valueField = this.querySelector('[name=teacher_id]');
   this.toggle = this.querySelector('button');
   this.popup = this.querySelector('.teacher-popup');
   this.list = this.querySelector('[role=listbox]');
   this.message = this.querySelector('[role=status]');
   this.committed = {id:this.valueField.value,name:this.input.value};
   this.active = -1;
   this.input.addEventListener('click', () => {
    if (!this.isOpen && this.valueField.value) this.input.select();
    this.open(false);
   });
   this.input.addEventListener('input', () => {
    this.valueField.value = '';
    this.input.setCustomValidity('Выберите преподавателя из списка');
    this.open(true);
   });
   this.input.addEventListener('keydown', event => this.onKey(event));
   this.toggle.addEventListener('mousedown', event => event.preventDefault());
   this.toggle.addEventListener('click', event => {
    this.input.focus({preventScroll:true});
    if (this.isOpen) this.close(event.detail === 0);
    else this.open(event.detail === 0);
   });
   // Keep focus on the combobox while a pointer chooses a listbox option.
   this.list.addEventListener('mousedown', event => event.preventDefault());
   this.list.addEventListener('click', event => {
    const option = event.target.closest('[role=option]');
    if (option) this.choose(Number(option.dataset.index),false);
   });
   this.input.addEventListener('blur', () => this.close(false));
  }
  get isOpen() { return this.input.getAttribute('aria-expanded') === 'true'; }
  open(keyboard) {
   this.toggleAttribute('data-instant',keyboard);
   if (!this.isOpen) {
    const bounds = this.input.getBoundingClientRect();
    const viewport = window.visualViewport;
    const bottom = viewport ? viewport.offsetTop + viewport.height : innerHeight;
    this.toggleAttribute('data-above',bottom-bounds.bottom<200 && bounds.top>(bottom-bounds.bottom));
    this.popup.inert = false;
    this.input.setAttribute('aria-expanded','true');
    this.toggle.setAttribute('aria-expanded','true');
    this.setAttribute('open','');
   }
   const words = normalize(this.valueField.value ? '' : this.input.value).split(/\s+/);
   this.matches = directory().filter(t => words.every(word => normalize(t.name).includes(word)));
   const options = this.matches.map((teacher,index) => {
    const item = document.createElement('div');
    item.setAttribute('role','option');
    item.id = this.list.id+'-'+teacher.id;
    item.dataset.index = index;
    item.setAttribute('aria-selected',String(String(teacher.id) === this.valueField.value));
    item.textContent = teacher.name;
    const info = document.createElement('small');
    info.textContent = [teacher.institute,'№ '+teacher.id].filter(Boolean).join(' · ');
    item.append(info);
    return item;
   });
   this.list.replaceChildren(...options);
   this.message.textContent = options.length ? '' : directory().length ? 'Преподаватель не найден' : 'В справочнике пока нет преподавателей';
   this.setActive(this.matches.findIndex(t => String(t.id) === this.valueField.value));
  }
  close(keyboard) {
   if (!this.isOpen) return;
   this.toggleAttribute('data-instant',keyboard);
   this.input.setAttribute('aria-expanded','false');
   this.toggle.setAttribute('aria-expanded','false');
   this.input.removeAttribute('aria-activedescendant');
   this.removeAttribute('open');
   this.popup.inert = true;
  }
  setActive(index) {
   this.list.children[this.active]?.removeAttribute('data-active');
   this.active = index;
   const item = this.list.children[index];
   if (!item) { this.input.removeAttribute('aria-activedescendant'); return; }
   item.setAttribute('data-active','');
   this.input.setAttribute('aria-activedescendant',item.id);
   if (item.offsetTop < this.popup.scrollTop) this.popup.scrollTop = item.offsetTop;
   else if (item.offsetTop+item.offsetHeight > this.popup.scrollTop+this.popup.clientHeight)
    this.popup.scrollTop = item.offsetTop+item.offsetHeight-this.popup.clientHeight;
  }
  choose(index,keyboard) {
   const teacher = this.matches[index];
   if (!teacher) return;
   this.committed = {id:String(teacher.id),name:teacher.name};
   this.restore();
   this.close(keyboard);
  }
  restore() {
   this.valueField.value = this.committed.id;
   this.input.value = this.committed.name;
   this.input.setCustomValidity('');
  }
  onKey(event) {
   if (event.isComposing) return;
   if (event.key === 'Tab') { this.close(true); return; }
   if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!this.isOpen) this.open(true);
    if (this.matches.length) {
     const next = event.key === 'ArrowDown' ? this.active+1 : this.active<0 ? this.matches.length-1 : this.active-1;
     this.setActive(Math.max(0,Math.min(this.matches.length-1,next)));
    }
   } else if (this.isOpen && event.key === 'Enter') {
    event.preventDefault();
    if (this.active>=0 || this.matches.length===1) this.choose(Math.max(0,this.active),true);
   } else if (this.isOpen && event.key === 'Escape') {
    event.preventDefault();
    this.restore();
    this.close(true);
   }
  }
 }
 customElements.define('teacher-picker',TeacherPicker);
}
