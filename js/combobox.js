/*
 * Selector con búsqueda (combobox accesible).
 *
 *   Combobox(input, list, {
 *     options: () => [{ id, label, detail, search }],
 *     onSelect: (option | null) => void,
 *     empty: 'Texto cuando no hay coincidencias',
 *   })
 *
 * Escribir filtra (sin distinguir acentos ni mayúsculas, todas las palabras deben
 * aparecer); ↑/↓ mueven la selección, Enter elige, Esc cierra.
 */
(function (root) {
  'use strict';

  var MAX = 200;

  function fold(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  }

  function Combobox(input, list, opts) {
    this.input = input;
    this.list = list;
    this.opts = opts;
    this.selected = null;
    this.items = [];
    this.active = -1;
    this.listId = list.id;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', list.id);
    list.setAttribute('role', 'listbox');
    list.hidden = true;

    var self = this;
    input.addEventListener('input', function () {
      if (self.selected && input.value !== self.selected.label) self.setSelected(null, true);
      self.open();
    });
    input.addEventListener('focus', function () { self.open(); input.select(); });
    input.addEventListener('click', function () { self.open(); });
    input.addEventListener('keydown', function (e) { self.onKey(e); });
    input.addEventListener('blur', function () {
      // Deja tiempo a un clic en la lista.
      setTimeout(function () {
        if (document.activeElement === input) return;
        self.close();
        if (!self.selected && self.items.length === 1 && input.value.trim()) self.choose(0, false);
        if (self.selected && input.value !== self.selected.label) input.value = self.selected.label;
      }, 120);
    });
    list.addEventListener('mousedown', function (e) { e.preventDefault(); });
    list.addEventListener('click', function (e) {
      var li = e.target.closest('[data-index]');
      if (li) self.choose(Number(li.getAttribute('data-index')), true);
    });
  }

  Combobox.prototype.filter = function () {
    var all = this.opts.options() || [];
    var q = fold(this.input.value).trim();
    if (!q || (this.selected && this.input.value === this.selected.label)) return all;
    var words = q.split(/\s+/);
    return all.filter(function (o) {
      var hay = fold(o.search || (o.label + ' ' + (o.detail || '')));
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
  };

  Combobox.prototype.open = function () {
    if (this.input.disabled) return;
    this.items = this.filter();
    var selId = this.selected && this.selected.id;
    this.active = -1;
    for (var i = 0; i < this.items.length; i++) if (this.items[i].id === selId) this.active = i;
    if (this.active < 0 && this.items.length && this.input.value.trim()) this.active = 0;
    this.render();
    this.list.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
  };

  Combobox.prototype.close = function () {
    this.list.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
  };

  Combobox.prototype.render = function () {
    var self = this;
    var frag = document.createDocumentFragment();
    if (!this.items.length) {
      var empty = document.createElement('li');
      empty.className = 'cb-empty';
      empty.textContent = this.opts.empty || 'Sin coincidencias';
      frag.appendChild(empty);
    }
    this.items.slice(0, MAX).forEach(function (o, i) {
      var li = document.createElement('li');
      li.id = self.listId + '-o' + i;
      li.className = 'cb-option';
      li.setAttribute('role', 'option');
      li.setAttribute('data-index', String(i));
      li.setAttribute('aria-selected', self.selected && self.selected.id === o.id ? 'true' : 'false');
      if (i === self.active) li.classList.add('is-active');
      var label = document.createElement('span');
      label.className = 'cb-label';
      label.textContent = o.label;
      li.appendChild(label);
      if (o.detail) {
        var detail = document.createElement('span');
        detail.className = 'cb-detail';
        detail.textContent = o.detail;
        li.appendChild(detail);
      }
      frag.appendChild(li);
    });
    this.list.replaceChildren(frag);
    this.syncActive();
  };

  Combobox.prototype.syncActive = function () {
    var lis = this.list.querySelectorAll('.cb-option');
    for (var i = 0; i < lis.length; i++) lis[i].classList.toggle('is-active', i === this.active);
    var act = this.active >= 0 && lis[this.active];
    if (act) {
      this.input.setAttribute('aria-activedescendant', act.id);
      var top = act.offsetTop, bottom = top + act.offsetHeight;
      if (top < this.list.scrollTop) this.list.scrollTop = top;
      else if (bottom > this.list.scrollTop + this.list.clientHeight) this.list.scrollTop = bottom - this.list.clientHeight;
    } else {
      this.input.removeAttribute('aria-activedescendant');
    }
  };

  Combobox.prototype.onKey = function (e) {
    var n = Math.min(this.items.length, MAX);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.list.hidden) { this.open(); return; }
      if (!n) return;
      this.active = e.key === 'ArrowDown' ? (this.active + 1) % n : (this.active <= 0 ? n - 1 : this.active - 1);
      this.syncActive();
    } else if (e.key === 'Enter') {
      if (!this.list.hidden && this.active >= 0) {
        e.preventDefault();
        this.choose(this.active, true);
      } else if (this.selected) {
        e.preventDefault();
        this.close();
        if (this.opts.onEnter) this.opts.onEnter();
      }
    } else if (e.key === 'Escape') {
      if (!this.list.hidden) {
        e.preventDefault();
        e.stopPropagation();
        this.close();
        if (this.selected) this.input.value = this.selected.label;
      }
    } else if (e.key === 'Tab' && !this.list.hidden && !this.selected && this.active >= 0 && this.input.value.trim()) {
      this.choose(this.active, false);
    }
  };

  Combobox.prototype.choose = function (i, advance) {
    var o = this.items[i];
    if (!o) return;
    this.input.value = o.label;
    this.close();
    this.setSelected(o, false, advance);
  };

  Combobox.prototype.setSelected = function (o, silentText, advance) {
    var changed = (this.selected && this.selected.id) !== (o && o.id);
    this.selected = o;
    if (o && !silentText) this.input.value = o.label;
    if (changed || advance) this.opts.onSelect(o, !!advance);
  };

  /** Selecciona por id sin abrir la lista (para restaurar la última elección). */
  Combobox.prototype.selectId = function (id) {
    var all = this.opts.options() || [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) {
        this.selected = all[i];
        this.input.value = all[i].label;
        return all[i];
      }
    }
    return null;
  };

  Combobox.prototype.reset = function () {
    this.selected = null;
    this.input.value = '';
    this.close();
  };

  root.Combobox = Combobox;
})(typeof globalThis !== 'undefined' ? globalThis : this);
