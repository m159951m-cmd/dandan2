/* 단단이 · 창과 메뉴의 움직임 (apple-design 원칙)
 * - 누른 그 자리에서 열리고, 같은 길로 닫힘 (창이 누른 곳에서 커지고, 그쪽으로 줄어듦)
 * - CSS transition 으로 만들어서 닫히는 중에 다시 열면 그 자리에서 되돌아옴 (중간에 끊기지 않음)
 * - 튕김 없는 부드러운 감속 곡선 하나만 사용, 닫힘은 열림보다 조금 짧게
 * - '동작 줄이기' 설정이면 크기 변화 없이 흐려지기만 함
 * 기존 코드는 그대로 el.hidden = true/false 를 쓰면 됨 (여기서 hidden 을 가로채서 움직임을 붙임)
 */
(function () {
  var D = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidden');
  if (!D || !D.set) return;
  var last = null, lastAt = 0;
  // 누른 위치를 기억 (창이 그 자리에서 열리도록)
  addEventListener('pointerdown', function (e) { last = { x: e.clientX, y: e.clientY }; lastAt = Date.now() }, true);

  var LEAVE_MS = 170;
  function boxOf(el) { return el.querySelector('.modal-box,.sheet,.ba') || el }
  function setOrigin(el) {
    var box = boxOf(el);
    if (el.classList.contains('m-pop')) return;                 // 작은 메뉴는 CSS에서 버튼 쪽 모서리로 고정
    if (last && Date.now() - lastAt < 1200) {
      var r = box.getBoundingClientRect();
      if (r.width && r.height) { box.style.transformOrigin = Math.round(last.x - r.left) + 'px ' + Math.round(last.y - r.top) + 'px'; return }
    }
    box.style.transformOrigin = '';
  }
  function enhance(el) {
    if (el.__motion) return; el.__motion = true;
    el.classList.add('m-anim');
    var closing = false, timer = 0;
    function open() {
      clearTimeout(timer);
      if (closing) { closing = false; el.classList.remove('m-leave'); return }   // 닫히던 중이면 그 자리에서 되돌아옴
      if (!D.get.call(el)) return;
      D.set.call(el, false);
      el.classList.add('m-enter');
      setOrigin(el);
      void el.offsetWidth;                                         // 시작 상태를 한 번 그린 뒤
      requestAnimationFrame(function () { el.classList.remove('m-enter') });
    }
    function close() {
      if (D.get.call(el) || closing) return;
      closing = true;
      el.classList.add('m-leave');
      timer = setTimeout(function () {
        if (!closing) return;
        closing = false; el.classList.remove('m-leave'); D.set.call(el, true);
      }, LEAVE_MS);
    }
    Object.defineProperty(el, 'hidden', {
      configurable: true,
      get: function () { return closing || D.get.call(el) },
      set: function (v) { v ? close() : open() }
    });
  }
  function scan() { document.querySelectorAll('.modal,.sheet-wrap,.m-pop').forEach(enhance) }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan); else scan();
  window.dandanMotion = { enhance: enhance, scan: scan };

  // 새로 만들어졌다 사라지는 창(마감 큰 알림 등)용
  window.dandanAppear = function (el) {
    el.classList.add('m-anim', 'm-enter'); setOrigin(el); void el.offsetWidth;
    requestAnimationFrame(function () { el.classList.remove('m-enter') });
  };
  window.dandanDismiss = function (el, done) {
    el.classList.add('m-anim', 'm-leave');
    setTimeout(function () { el.remove(); done && done() }, LEAVE_MS);
  };
})();
