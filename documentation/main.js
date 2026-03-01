import integrationMd from '../docs/INTEGRATION_GUIDE.md?raw';
import apiMd from '../docs/API_REFERENCE.md?raw';

// Configuration for marked + highlight.js
marked.setOptions({
    highlight: function (code, lang) {
        if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
    },
    breaks: true,
    gfm: true
});

const pages = {
    'integration': integrationMd,
    'api': apiMd
};

// Global function to navigate between documentation pages
window.setPage = function (pageName) {
    if (!pages[pageName]) pageName = 'integration';

    // Update active tab style
    document.querySelectorAll('.menu-link').forEach(link => link.classList.remove('active'));
    const tabEl = document.getElementById('tab-' + pageName);
    if (tabEl) tabEl.classList.add('active');

    // Update URL query parameters without reloading
    const url = new URL(window.location);
    url.searchParams.set('page', pageName);
    window.history.pushState({}, '', url);

    // Render markdown content
    document.getElementById('markdown-body').innerHTML = marked.parse(pages[pageName]);

    // Scroll to top
    document.querySelector('.content-container').scrollTop = 0;
};

// Initial load check on page ready
window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    window.setPage(params.get('page') || 'integration');
});

// Handle browser Back/Forward (popstate)
window.addEventListener('popstate', () => {
    const params = new URLSearchParams(window.location.search);
    window.setPage(params.get('page') || 'integration');
});
