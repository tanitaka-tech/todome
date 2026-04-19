(function () {
  // --- Sidebar drawer toggle (mobile) ---
  var toggle = document.querySelector(".menu-toggle");
  if (toggle) {
    toggle.addEventListener("click", function () {
      document.body.classList.toggle("sidebar-open");
    });
    document.addEventListener("click", function (e) {
      if (!document.body.classList.contains("sidebar-open")) return;
      if (
        e.target.closest(".sidebar") ||
        e.target.closest(".menu-toggle")
      ) {
        return;
      }
      document.body.classList.remove("sidebar-open");
    });
  }

  // --- Active link highlighting ---
  // data-page 属性がページルート <body> と sidebar-link にあり、一致するものを強調
  var currentPage = document.body.getAttribute("data-page");
  if (currentPage) {
    var links = document.querySelectorAll(".sidebar-link");
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute("data-page") === currentPage) {
        links[i].classList.add("is-active");
      }
    }
  }

  // --- Collapsible sidebar groups ---
  var groupTitles = document.querySelectorAll(".sidebar-group-title");
  for (var j = 0; j < groupTitles.length; j++) {
    groupTitles[j].addEventListener("click", function (e) {
      e.currentTarget.parentElement.classList.toggle("is-collapsed");
    });
  }

  // --- Image lightbox ---
  // ハイライト/本文内のスクショや WebP をクリックで拡大表示する。
  // トップの card-thumb はページ遷移リンクなので対象外。
  var zoomables = document.querySelectorAll(
    ".highlight-card img, .hero-shot img, .inline-shot img",
  );
  if (zoomables.length > 0) {
    var overlay = null;
    var closeLightbox = function () {
      if (!overlay) return;
      overlay.classList.remove("is-open");
      var node = overlay;
      setTimeout(function () {
        if (node && node.parentNode) node.parentNode.removeChild(node);
      }, 180);
      overlay = null;
      document.body.classList.remove("lightbox-lock");
    };
    var openLightbox = function (src, alt) {
      if (overlay) closeLightbox();
      overlay = document.createElement("div");
      overlay.className = "lightbox-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", alt || "拡大表示");
      var img = document.createElement("img");
      img.className = "lightbox-img";
      img.src = src;
      img.alt = alt || "";
      var close = document.createElement("button");
      close.className = "lightbox-close";
      close.type = "button";
      close.setAttribute("aria-label", "閉じる");
      close.innerHTML = "&times;";
      overlay.appendChild(img);
      overlay.appendChild(close);
      document.body.appendChild(overlay);
      document.body.classList.add("lightbox-lock");
      // 次フレームで is-open を付けてフェードイン
      requestAnimationFrame(function () {
        if (overlay) overlay.classList.add("is-open");
      });
      overlay.addEventListener("click", function (e) {
        if (e.target === img) return;
        closeLightbox();
      });
    };
    for (var k = 0; k < zoomables.length; k++) {
      (function (el) {
        el.classList.add("is-zoomable");
        el.addEventListener("click", function () {
          openLightbox(el.getAttribute("src"), el.getAttribute("alt"));
        });
      })(zoomables[k]);
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay) closeLightbox();
    });
  }
})();
