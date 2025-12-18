// Minimal sortable list with drag and drop (global SimpleSorter)
// Usage: new window.SimpleSorter(container, { onUpdate: (order) => {} })
(function () {
  class SimpleSorter {
    constructor(container, opts = {}) {
      this.container = container;
      this.onUpdate = opts.onUpdate || (() => {});
      this.draggingEl = null;
      this.placeholder = document.createElement('div');
      this.placeholder.className = 'sortable-placeholder';
      this.placeholder.style.height = '8px';
      this.placeholder.style.margin = '4px 0';
      this.placeholder.style.border = '1px dashed #4b5563';

      this.bind();
    }

    bind() {
      this.container.querySelectorAll('[data-sort-id]').forEach(el => {
        el.setAttribute('draggable', 'true');
        el.addEventListener('dragstart', this.onDragStart.bind(this));
        el.addEventListener('dragover', this.onDragOver.bind(this));
        el.addEventListener('dragend', this.onDragEnd.bind(this));
        el.addEventListener('drop', this.onDrop.bind(this));
      });
    }

    onDragStart(e) {
      this.draggingEl = e.currentTarget;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', this.draggingEl.dataset.sortId);
      this.draggingEl.classList.add('opacity-50');
    }

    onDragOver(e) {
      e.preventDefault();
      const target = e.currentTarget;
      if (target === this.draggingEl) return;
      const rect = target.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      if (before) {
        target.parentNode.insertBefore(this.placeholder, target);
      } else {
        target.parentNode.insertBefore(this.placeholder, target.nextSibling);
      }
    }

    onDrop(e) {
      e.preventDefault();
      this.finishDrag();
    }

    onDragEnd() {
      this.finishDrag();
    }

    finishDrag() {
      if (!this.draggingEl) return;
      if (this.placeholder.parentNode) {
        this.placeholder.parentNode.insertBefore(this.draggingEl, this.placeholder);
      }
      this.placeholder.remove();
      this.draggingEl.classList.remove('opacity-50');
      this.draggingEl = null;
      this.emitOrder();
    }

    emitOrder() {
      const order = Array.from(this.container.querySelectorAll('[data-sort-id]')).map((el, idx) => ({
        id: el.dataset.sortId,
        orderIndex: idx + 1,
      }));
      this.onUpdate(order);
    }
  }

  window.SimpleSorter = SimpleSorter;
})();
