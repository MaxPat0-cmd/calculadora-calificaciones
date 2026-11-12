// Movimiento con springs (damping + response, como los define Apple), traducido a la web.
// Las animaciones arrancan desde el valor que se ve en pantalla, así que se pueden
// interrumpir y redirigir sin saltos. Con "reducir movimiento" solo hay fundidos cortos.
(function (root) {
  'use strict';

  var mq = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var supportsLinear = !!(root.CSS && CSS.supports && CSS.supports('transition-timing-function', 'linear(0, 1)'));
  var cache = {};

  function reduced() {
    return !!(mq && mq.matches);
  }

  /**
   * Curva de un spring de 0 a 1. damping: 1 = sin rebote; < 1 = rebota.
   * response: segundos que tarda en llegar (no es una duración fija).
   * Devuelve { easing, duration } para la Web Animations API o transiciones CSS.
   */
  function spring(damping, response) {
    var key = damping + ':' + response;
    if (cache[key]) return cache[key];
    var omega = (2 * Math.PI) / response;
    var dt = 1 / 600;
    var x = 0;
    var v = 0;
    var t = 0;
    var samples = [0];
    var still = 0;
    while (t < 3) {
      var a = -omega * omega * (x - 1) - 2 * damping * omega * v;
      v += a * dt;
      x += v * dt;
      t += dt;
      samples.push(x);
      still = Math.abs(x - 1) < 0.0015 && Math.abs(v) < 0.02 ? still + 1 : 0;
      if (still > 30) break;
    }
    var duration = Math.round(t * 1000);
    var easing;
    if (supportsLinear) {
      var points = [];
      var steps = 48;
      for (var i = 0; i <= steps; i++) {
        var idx = Math.round((i / steps) * (samples.length - 1));
        points.push(i === steps ? 1 : Math.round(samples[idx] * 10000) / 10000);
      }
      easing = 'linear(' + points.join(', ') + ')';
    } else {
      easing = damping >= 1 ? 'cubic-bezier(0.22, 1, 0.36, 1)' : 'cubic-bezier(0.34, 1.3, 0.64, 1)';
    }
    cache[key] = { easing: easing, duration: duration };
    return cache[key];
  }

  /**
   * Anima propiedades { prop: [desde, hasta] }. Si el elemento ya se estaba moviendo,
   * empieza desde su valor actual en pantalla. "hasta" debe ser el estado normal del CSS.
   */
  function animate(el, frames, opts) {
    if (!el || typeof el.animate !== 'function') return null;
    opts = opts || {};
    var props = Object.keys(frames);
    var running = el.getAnimations ? el.getAnimations().filter(function (a) { return a.motion; }) : [];
    var current = {};
    if (running.length) {
      var cs = root.getComputedStyle(el);
      props.forEach(function (p) { current[p] = cs[p]; });
    }
    running.forEach(function (a) { a.cancel(); });

    var from = {};
    var to = {};
    var anim;
    if (reduced()) {
      if (!frames.opacity) return null;
      from.opacity = running.length ? current.opacity : frames.opacity[0];
      to.opacity = frames.opacity[1];
      anim = el.animate([from, to], { duration: 160, easing: 'ease-out' });
    } else {
      props.forEach(function (p) {
        from[p] = running.length ? current[p] : frames[p][0];
        to[p] = frames[p][1];
      });
      var s = spring(opts.damping == null ? 1 : opts.damping, opts.response || 0.35);
      anim = el.animate([from, to], { duration: s.duration, easing: s.easing, delay: opts.delay || 0, fill: 'backwards' });
    }
    anim.motion = true;
    return anim;
  }

  /** Aparece como un material: escala, desenfoque y opacidad juntos. */
  function materialize(el, opts) {
    opts = opts || {};
    var y = opts.y == null ? 6 : opts.y;
    var blur = opts.blur == null ? 6 : opts.blur;
    var frames = {
      opacity: [0, 1],
      transform: ['translateY(' + y + 'px) scale(' + (opts.scale || 0.97) + ')', 'none'],
    };
    if (blur > 0) frames.filter = ['blur(' + blur + 'px)', 'blur(0px)'];
    return animate(el, frames, opts);
  }

  /** Entra desde la dirección del cambio (1 = siguiente, -1 = anterior). */
  function slide(el, dir, opts) {
    return animate(el, {
      opacity: [0.2, 1],
      transform: ['translateX(' + (dir * 28) + 'px)', 'none'],
    }, opts);
  }

  /** Un valor nuevo que llega (la calificación final). */
  function pop(el, opts) {
    return animate(el, {
      opacity: [0.35, 1],
      transform: ['translateY(8px) scale(0.92)', 'none'],
    }, opts || { response: 0.4 });
  }

  // Springs disponibles para las transiciones de CSS (presionar botones, barras, etc.).
  function exposeCssSprings() {
    var style = document.documentElement.style;
    var base = spring(1, 0.35);
    var quick = spring(1, 0.22);
    style.setProperty('--spring', base.easing);
    style.setProperty('--spring-duration', base.duration + 'ms');
    style.setProperty('--spring-quick', quick.easing);
    style.setProperty('--spring-quick-duration', quick.duration + 'ms');
  }

  if (typeof document !== 'undefined') exposeCssSprings();

  var api = { spring: spring, animate: animate, materialize: materialize, slide: slide, pop: pop, reduced: reduced };
  root.Motion = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
