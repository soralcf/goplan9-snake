(function () {
  'use strict';

  const vscode =
    typeof acquireVsCodeApi === 'function'
      ? acquireVsCodeApi()
      : { postMessage: function () {} };

  const content = document.getElementById('content');
  const tocList = document.getElementById('toc-list');
  const tocToggle = document.getElementById('toc-toggle');
  const searchInput = document.getElementById('search');
  const searchCount = document.getElementById('search-count');
  const searchPrev = document.getElementById('search-prev');
  const searchNext = document.getElementById('search-next');

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      switch (character) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        case "'":
          return '&#39;';
        default:
          return character;
      }
    });
  }

  function highlightAsm(source) {
    return source
      .split('\n')
      .map(function (line) {
        const commentIndex = line.indexOf('//');
        const code = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
        const comment = commentIndex >= 0 ? line.slice(commentIndex) : '';
        let html = escapeHtml(code);

        html = html.replace(
          /^(\s*)([A-Za-z_.$·][\w.$·<>]*):/,
          function (match, space, label) {
            return space + '<span class="tok-label">' + label + '</span>:';
          }
        );
        html = html.replace(/^(\s*)(#[A-Za-z]+)/, function (match, space, directive) {
          return space + '<span class="tok-op">' + directive + '</span>';
        });
        html = html.replace(/^(\s*)([A-Z][A-Z0-9.]*)\b/, function (match, space, op) {
          return space + '<span class="tok-op">' + op + '</span>';
        });
        html = html.replace(
          /\b(R(?:[0-9]|[12][0-9]|30)|RSP|ZR|LR|FP|SP|SB|PC|TLS|F(?:[0-9]|[12][0-9]|3[01])|V(?:[0-9]|[12][0-9]|3[01]))\b/g,
          '<span class="tok-reg">$1</span>'
        );
        html = html.replace(/\$[^\s,]+/g, '<span class="tok-imm">$&</span>');
        html = html.replace(/·[\w.$]+/g, '<span class="tok-sym">$&</span>');
        html = html.replace(
          /&quot;[^&]*&quot;/g,
          '<span class="tok-str">$&</span>'
        );

        if (comment) {
          html += '<span class="tok-comment">' + escapeHtml(comment) + '</span>';
        }
        return html;
      })
      .join('\n');
  }

  for (const block of document.querySelectorAll('pre > code.language-asm')) {
    block.innerHTML = highlightAsm(block.textContent);
  }

  for (const pre of document.querySelectorAll('pre')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-btn';
    button.textContent = '复制';
    button.setAttribute('aria-label', '复制代码');
    button.addEventListener('click', function () {
      const code = pre.querySelector('code');
      vscode.postMessage({
        type: 'copy',
        text: code ? code.textContent : pre.textContent,
      });
      button.textContent = '已复制';
      window.setTimeout(function () {
        button.textContent = '复制';
      }, 1200);
    });
    pre.appendChild(button);
  }

  const headings = Array.from(content.querySelectorAll('h2, h3'));
  const tocLinks = new Map();

  for (const heading of headings) {
    if (!heading.id) {
      continue;
    }
    const link = document.createElement('a');
    link.href = '#' + heading.id;
    link.textContent = heading.textContent;
    link.className = 'toc-' + heading.tagName.toLowerCase();
    link.addEventListener('click', function (event) {
      event.preventDefault();
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.body.classList.remove('toc-open');
    });
    tocList.appendChild(link);
    tocLinks.set(heading.id, link);
  }

  if (headings.length === 0) {
    document.body.classList.add('no-toc');
  }

  let scrollTicking = false;

  function updateActiveHeading() {
    const threshold = 84;
    let active = null;
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top <= threshold) {
        active = heading;
      } else {
        break;
      }
    }
    for (const link of tocLinks.values()) {
      link.classList.remove('active');
    }
    if (!active) {
      return;
    }
    const link = tocLinks.get(active.id);
    if (link) {
      link.classList.add('active');
      const top = link.offsetTop;
      const viewTop = tocList.parentElement.scrollTop;
      const viewBottom = viewTop + tocList.parentElement.clientHeight;
      if (top < viewTop || top > viewBottom - 28) {
        link.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  window.addEventListener(
    'scroll',
    function () {
      if (scrollTicking) {
        return;
      }
      scrollTicking = true;
      window.requestAnimationFrame(function () {
        scrollTicking = false;
        updateActiveHeading();
      });
    },
    { passive: true }
  );

  updateActiveHeading();

  let hits = [];
  let hitIndex = -1;

  function clearHighlights() {
    for (const mark of content.querySelectorAll('mark.gah-hit')) {
      const parent = mark.parentNode;
      if (!parent) {
        continue;
      }
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    }
    hits = [];
    hitIndex = -1;
  }

  function updateSearchCount() {
    const hasHits = hits.length > 0;
    if (searchPrev) {
      searchPrev.disabled = !hasHits;
    }
    if (searchNext) {
      searchNext.disabled = !hasHits;
    }
    if (!hasHits) {
      searchCount.textContent = searchInput.value.trim() ? '未找到' : '';
      return;
    }
    searchCount.textContent = `${hitIndex + 1} / ${hits.length}`;
  }

  function focusHit(index, shouldScroll) {
    if (hits.length === 0) {
      updateSearchCount();
      return;
    }
    if (hitIndex >= 0 && hits[hitIndex]) {
      hits[hitIndex].classList.remove('current');
    }
    hitIndex = (index + hits.length) % hits.length;
    const mark = hits[hitIndex];
    mark.classList.add('current');
    if (shouldScroll) {
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    updateSearchCount();
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function runSearch(query, focusIndex = 0) {
    clearHighlights();
    const term = query.trim();
    if (!term) {
      updateSearchCount();
      return;
    }

    const pattern = new RegExp(escapeRegExp(term), 'giu');
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || node.nodeValue.trim() === '') {
          return NodeFilter.FILTER_REJECT;
        }
        const parent = node.parentElement;
        if (!parent || parent.closest('script, style, mark.gah-hit')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    for (const node of textNodes) {
      const text = node.nodeValue;
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      let matched = false;
      let match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(text)) !== null) {
        matched = true;
        if (match.index > lastIndex) {
          fragment.appendChild(
            document.createTextNode(text.slice(lastIndex, match.index))
          );
        }
        const mark = document.createElement('mark');
        mark.className = 'gah-hit';
        mark.textContent = match[0];
        fragment.appendChild(mark);
        hits.push(mark);
        lastIndex = match.index + match[0].length;
        if (match[0].length === 0) {
          pattern.lastIndex++;
        }
      }
      if (matched) {
        if (lastIndex < text.length) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
        }
        node.parentNode.replaceChild(fragment, node);
      }
    }

    if (hits.length > 0) {
      focusHit(focusIndex < 0 ? hits.length - 1 : focusIndex, true);
    } else {
      updateSearchCount();
    }
  }

  let searchTimer;

  // Enter can arrive before the debounce timer fires. Run the pending search
  // first so the first Enter is not swallowed and later does not reset to hit 0.
  function runPendingSearch(focusIndex) {
    if (searchTimer === undefined) {
      return false;
    }
    window.clearTimeout(searchTimer);
    searchTimer = undefined;
    runSearch(searchInput.value, focusIndex);
    return true;
  }

  searchInput.addEventListener('input', function () {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(function () {
      searchTimer = undefined;
      runSearch(searchInput.value);
    }, 120);
  });

  function stepSearch(delta) {
    // A pending debounce means the query has not been highlighted yet; run it
    // now and land on the far end in the requested direction.
    if (runPendingSearch(delta < 0 ? -1 : 0)) {
      return;
    }
    if (hits.length > 0) {
      focusHit(hitIndex + delta, true);
    }
  }

  function bindSearchNav(button, delta) {
    if (!button) {
      return;
    }
    // Keep focus in the search field so typing can continue after a click.
    button.addEventListener('mousedown', function (event) {
      event.preventDefault();
    });
    button.addEventListener('click', function () {
      searchInput.focus();
      stepSearch(delta);
    });
  }

  bindSearchNav(searchPrev, -1);
  bindSearchNav(searchNext, 1);

  searchInput.addEventListener('keydown', function (event) {
    // Let the IME handle Enter and arrow keys while composing Chinese input.
    if (event.isComposing) {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      stepSearch(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      stepSearch(event.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      searchInput.value = '';
      runSearch('');
      searchInput.blur();
    }
  });

  window.addEventListener('keydown', function (event) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      searchInput.focus();
      searchInput.select();
      return;
    }
    if (event.key === 'Escape' && document.activeElement !== searchInput) {
      if (searchInput.value) {
        searchInput.value = '';
        runSearch('');
      }
    }
  });

  if (tocToggle) {
    tocToggle.addEventListener('click', function () {
      const open = document.body.classList.toggle('toc-open');
      tocToggle.setAttribute('aria-expanded', String(open));
    });
  }

  document.addEventListener('click', function (event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const link = target.closest('a');
    if (!link) {
      return;
    }

    if (link.dataset.file) {
      event.preventDefault();
      vscode.postMessage({ type: 'openFile', path: link.dataset.file });
      return;
    }

    const href = link.getAttribute('href') || '';
    if (/^https?:\/\//i.test(href)) {
      event.preventDefault();
      vscode.postMessage({ type: 'openExternal', url: href });
    }
  });
})();
