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
})();
