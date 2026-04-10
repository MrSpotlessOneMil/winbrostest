/**
 * WinBros Blog Renderer — Embeddable Widget
 *
 * Blog index page:
 *   <div id="winbros-blog"></div>
 *   <script src="https://your-osiris-url/embed/winbros-blog.js"></script>
 *
 * Single post is selected via ?post=slug-here in the page URL.
 * Self-contained, zero dependencies, Shadow DOM for CSS isolation.
 */
(function () {
  "use strict";

  var API_BASE = (function () {
    var scripts = document.getElementsByTagName("script");
    var src = scripts[scripts.length - 1].src;
    var url = new URL(src);
    return url.origin + "/api/blog/winbros";
  })();

  var STYLES = "\n\
    :host { display: block; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; }\n\
    * { box-sizing: border-box; margin: 0; padding: 0; }\n\
    a { color: #2563eb; text-decoration: none; }\n\
    a:hover { text-decoration: underline; }\n\
    .wb-container { max-width: 800px; margin: 0 auto; padding: 16px; }\n\
    .wb-header { margin-bottom: 32px; }\n\
    .wb-header h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }\n\
    .wb-header p { font-size: 15px; color: #666; }\n\
    \n\
    /* Skeleton loading */\n\
    .wb-skeleton { animation: wb-pulse 1.5s ease-in-out infinite; background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%); background-size: 200% 100%; border-radius: 8px; }\n\
    .wb-skeleton-title { height: 24px; width: 70%; margin-bottom: 12px; }\n\
    .wb-skeleton-text { height: 14px; width: 100%; margin-bottom: 8px; }\n\
    .wb-skeleton-text.short { width: 40%; }\n\
    .wb-skeleton-card { padding: 24px; margin-bottom: 20px; border: 1px solid #e5e7eb; border-radius: 12px; }\n\
    @keyframes wb-pulse { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }\n\
    \n\
    /* Post list */\n\
    .wb-post-card { padding: 24px; margin-bottom: 20px; border: 1px solid #e5e7eb; border-radius: 12px; transition: box-shadow 0.2s; }\n\
    .wb-post-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); }\n\
    .wb-post-meta { display: flex; gap: 12px; font-size: 13px; color: #888; margin-bottom: 8px; }\n\
    .wb-post-category { background: #eff6ff; color: #2563eb; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }\n\
    .wb-post-title { font-size: 20px; font-weight: 700; margin-bottom: 8px; line-height: 1.3; }\n\
    .wb-post-title a { color: inherit; }\n\
    .wb-post-title a:hover { color: #2563eb; text-decoration: none; }\n\
    .wb-post-excerpt { font-size: 15px; color: #555; line-height: 1.6; }\n\
    .wb-read-more { display: inline-block; margin-top: 12px; font-size: 14px; font-weight: 600; }\n\
    \n\
    /* Single post */\n\
    .wb-back { display: inline-block; margin-bottom: 20px; font-size: 14px; font-weight: 600; }\n\
    .wb-article-title { font-size: 32px; font-weight: 700; margin-bottom: 12px; line-height: 1.2; }\n\
    .wb-article-meta { display: flex; gap: 16px; font-size: 14px; color: #888; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 1px solid #e5e7eb; }\n\
    .wb-article-content { font-size: 16px; line-height: 1.8; }\n\
    .wb-article-content h2 { font-size: 22px; font-weight: 700; margin: 28px 0 12px; }\n\
    .wb-article-content h3 { font-size: 18px; font-weight: 600; margin: 20px 0 8px; }\n\
    .wb-article-content p { margin-bottom: 16px; }\n\
    .wb-article-content ul, .wb-article-content ol { margin: 12px 0 16px 24px; }\n\
    .wb-article-content li { margin-bottom: 6px; }\n\
    .wb-article-content strong { font-weight: 600; }\n\
    \n\
    /* Pagination */\n\
    .wb-pagination { display: flex; justify-content: center; gap: 8px; margin-top: 32px; }\n\
    .wb-page-btn { padding: 8px 16px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; cursor: pointer; font-size: 14px; }\n\
    .wb-page-btn:hover { background: #f9fafb; }\n\
    .wb-page-btn:disabled { opacity: 0.5; cursor: not-allowed; }\n\
    .wb-page-btn.active { background: #2563eb; color: #fff; border-color: #2563eb; }\n\
    \n\
    .wb-empty { text-align: center; padding: 48px 16px; color: #888; font-size: 16px; }\n\
    .wb-error { text-align: center; padding: 32px 16px; color: #991b1b; background: #fef2f2; border-radius: 8px; font-size: 14px; }\n\
  ";

  function getPostSlug() {
    var params = new URLSearchParams(window.location.search);
    return params.get("post");
  }

  function formatDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }

  function showSkeleton(container, count) {
    var html = '<div class="wb-container">';
    for (var i = 0; i < count; i++) {
      html +=
        '<div class="wb-skeleton-card">' +
          '<div class="wb-skeleton wb-skeleton-title"></div>' +
          '<div class="wb-skeleton wb-skeleton-text"></div>' +
          '<div class="wb-skeleton wb-skeleton-text"></div>' +
          '<div class="wb-skeleton wb-skeleton-text short"></div>' +
        '</div>';
    }
    html += '</div>';
    container.innerHTML = html;
  }

  function renderPostList(container, data) {
    var posts = data.posts;
    var pagination = data.pagination;

    if (!posts || posts.length === 0) {
      container.innerHTML = '<div class="wb-container"><div class="wb-empty">No blog posts yet. Check back soon!</div></div>';
      return;
    }

    var html = '<div class="wb-container">';
    html += '<div class="wb-header"><h1>Blog</h1><p>Tips, guides, and insights from the WinBros team.</p></div>';

    for (var i = 0; i < posts.length; i++) {
      var p = posts[i];
      var url = window.location.pathname + "?post=" + encodeURIComponent(p.slug);
      html +=
        '<article class="wb-post-card">' +
          '<div class="wb-post-meta">' +
            (p.category ? '<span class="wb-post-category">' + escapeHtml(p.category) + '</span>' : '') +
            '<span>' + formatDate(p.published_at) + '</span>' +
            '<span>' + (p.reading_time || 5) + ' min read</span>' +
          '</div>' +
          '<h2 class="wb-post-title"><a href="' + url + '">' + escapeHtml(p.title) + '</a></h2>' +
          '<p class="wb-post-excerpt">' + escapeHtml(p.excerpt || '') + '</p>' +
          '<a href="' + url + '" class="wb-read-more">Read more &rarr;</a>' +
        '</article>';

      // Inject JSON-LD for SEO
      injectJsonLd(p);
    }

    // Pagination
    if (pagination && pagination.totalPages > 1) {
      html += '<div class="wb-pagination">';
      html += '<button class="wb-page-btn" data-page="' + (pagination.page - 1) + '"' + (pagination.page <= 1 ? ' disabled' : '') + '>&laquo; Prev</button>';
      html += '<button class="wb-page-btn" data-page="' + (pagination.page + 1) + '"' + (pagination.page >= pagination.totalPages ? ' disabled' : '') + '>Next &raquo;</button>';
      html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;

    // Bind pagination clicks
    var btns = container.querySelectorAll(".wb-page-btn");
    for (var j = 0; j < btns.length; j++) {
      btns[j].addEventListener("click", function () {
        var page = parseInt(this.getAttribute("data-page"), 10);
        if (page >= 1) loadPosts(container, page);
      });
    }
  }

  function renderSinglePost(container, post) {
    var backUrl = window.location.pathname;
    var html = '<div class="wb-container">';
    html += '<a href="' + backUrl + '" class="wb-back">&larr; Back to all posts</a>';
    html += '<h1 class="wb-article-title">' + escapeHtml(post.title) + '</h1>';
    html += '<div class="wb-article-meta">';
    if (post.category) html += '<span class="wb-post-category">' + escapeHtml(post.category) + '</span>';
    html += '<span>' + formatDate(post.published_at) + '</span>';
    html += '<span>' + (post.reading_time || 5) + ' min read</span>';
    html += '</div>';
    html += '<div class="wb-article-content">' + post.content + '</div>';
    html += '</div>';
    container.innerHTML = html;

    // Full article JSON-LD
    injectArticleJsonLd(post);
  }

  function injectJsonLd(post) {
    var ld = {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "headline": post.title,
      "description": post.meta_description || post.excerpt || "",
      "datePublished": post.published_at,
      "author": { "@type": "Organization", "name": "WinBros Services" }
    };
    var script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = JSON.stringify(ld);
    document.head.appendChild(script);
  }

  function injectArticleJsonLd(post) {
    var ld = {
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": post.title,
      "description": post.meta_description || post.excerpt || "",
      "datePublished": post.published_at,
      "author": { "@type": "Organization", "name": "WinBros Services" },
      "articleBody": post.excerpt || ""
    };
    var script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = JSON.stringify(ld);
    document.head.appendChild(script);

    // Update page meta
    if (post.meta_description) {
      var meta = document.querySelector('meta[name="description"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("name", "description");
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", post.meta_description);
    }
    if (post.title) {
      document.title = post.title + " | WinBros Blog";
    }
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function loadPosts(container, page) {
    showSkeleton(container, 3);

    var xhr = new XMLHttpRequest();
    xhr.open("GET", API_BASE + "?page=" + (page || 1) + "&limit=10", true);
    xhr.timeout = 15000;

    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var data = JSON.parse(xhr.responseText);
          renderPostList(container, data);
        } catch (e) {
          container.innerHTML = '<div class="wb-container"><div class="wb-error">Failed to load blog posts.</div></div>';
        }
      } else {
        container.innerHTML = '<div class="wb-container"><div class="wb-error">Failed to load blog posts.</div></div>';
      }
    };

    xhr.onerror = function () {
      container.innerHTML = '<div class="wb-container"><div class="wb-error">Network error. Please try again later.</div></div>';
    };

    xhr.ontimeout = function () {
      container.innerHTML = '<div class="wb-container"><div class="wb-error">Request timed out. Please try again.</div></div>';
    };

    xhr.send();
  }

  function loadSinglePost(container, slug) {
    showSkeleton(container, 1);

    var xhr = new XMLHttpRequest();
    xhr.open("GET", API_BASE + "?post=" + encodeURIComponent(slug), true);
    xhr.timeout = 15000;

    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var data = JSON.parse(xhr.responseText);
          if (data.post) {
            renderSinglePost(container, data.post);
          } else {
            container.innerHTML = '<div class="wb-container"><div class="wb-error">Post not found.</div></div>';
          }
        } catch (e) {
          container.innerHTML = '<div class="wb-container"><div class="wb-error">Failed to load post.</div></div>';
        }
      } else if (xhr.status === 404) {
        container.innerHTML = '<div class="wb-container"><div class="wb-error">Post not found.</div></div>';
      } else {
        container.innerHTML = '<div class="wb-container"><div class="wb-error">Failed to load post.</div></div>';
      }
    };

    xhr.onerror = function () {
      container.innerHTML = '<div class="wb-container"><div class="wb-error">Network error. Please try again later.</div></div>';
    };

    xhr.ontimeout = function () {
      container.innerHTML = '<div class="wb-container"><div class="wb-error">Request timed out. Please try again.</div></div>';
    };

    xhr.send();
  }

  function init() {
    var host = document.getElementById("winbros-blog");
    if (!host) return;

    var shadow = host.attachShadow({ mode: "open" });

    var style = document.createElement("style");
    style.textContent = STYLES;
    shadow.appendChild(style);

    var wrapper = document.createElement("div");
    shadow.appendChild(wrapper);

    var postSlug = getPostSlug();
    if (postSlug) {
      loadSinglePost(wrapper, postSlug);
    } else {
      loadPosts(wrapper, 1);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
