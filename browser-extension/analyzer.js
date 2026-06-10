// Injected into the page to collect source and run rule-based authorship checks

(function () {
  const html = document.documentElement.outerHTML;
  const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
  const links = Array.from(document.querySelectorAll('link[href]')).map(l => l.href);
  const allText = html;

  // --- Rule sets ---

  const AUTHOR_PATTERNS = [
    { re: /(?:coded|written|developed|built)\s+by\s+([^\n<*]{2,60})/gi, label: 'Coded by' },
    { re: /(?:author|@author)\s*[:\-]\s*([^\n<*]{2,60})/gi, label: 'Author' },
    { re: /(?:created|made)\s+by\s+([^\n<*]{2,60})/gi, label: 'Created by' },
    { re: /(?:copyright|©|\(c\))\s*(?:\d{4}[-–]\d{4}|\d{4})?\s*([^\n<*]{2,80})/gi, label: 'Copyright' },
    { re: /credits?\s*[:\-]\s*([^\n<*]{2,60})/gi, label: 'Credits' },
  ];

  const KNOWN_LIBRARIES = [
    { name: 'jQuery', patterns: [/jquery(?:\.min)?\.js/i, /\/jquery\//i] },
    { name: 'Bootstrap', patterns: [/bootstrap(?:\.min)?\.(?:js|css)/i, /\/bootstrap\//i] },
    { name: 'React', patterns: [/react(?:\.min)?\.js/i, /\/react\//i, /react-dom/i] },
    { name: 'Vue.js', patterns: [/vue(?:\.min)?\.js/i, /\/vue\//i] },
    { name: 'Angular', patterns: [/angular(?:\.min)?\.js/i, /\/angular\//i] },
    { name: 'Lodash', patterns: [/lodash(?:\.min)?\.js/i] },
    { name: 'Moment.js', patterns: [/moment(?:\.min)?\.js/i] },
    { name: 'Axios', patterns: [/axios(?:\.min)?\.js/i] },
    { name: 'D3.js', patterns: [/d3(?:\.min)?\.js/i, /\/d3\//i] },
    { name: 'Three.js', patterns: [/three(?:\.min)?\.js/i] },
    { name: 'Font Awesome', patterns: [/font-awesome/i, /fontawesome/i] },
    { name: 'Tailwind CSS', patterns: [/tailwind(?:\.min)?\.css/i, /tailwindcss/i] },
    { name: 'Animate.css', patterns: [/animate(?:\.min)?\.css/i] },
    { name: 'Swiper', patterns: [/swiper(?:\.min)?\.(?:js|css)/i] },
    { name: 'Chart.js', patterns: [/chart(?:\.min)?\.js/i] },
    { name: 'Leaflet', patterns: [/leaflet(?:\.min)?\.(?:js|css)/i] },
    { name: 'GSAP', patterns: [/gsap(?:\.min)?\.js/i, /TweenMax/i, /TweenLite/i] },
    { name: 'Underscore.js', patterns: [/underscore(?:\.min)?\.js/i] },
    { name: 'Backbone.js', patterns: [/backbone(?:\.min)?\.js/i] },
    { name: 'Ember.js', patterns: [/ember(?:\.min)?\.js/i] },
    { name: 'Svelte', patterns: [/svelte/i] },
    { name: 'Alpine.js', patterns: [/alpinejs/i, /alpine(?:\.min)?\.js/i] },
    { name: 'htmx', patterns: [/htmx(?:\.min)?\.js/i] },
    { name: 'Materialize', patterns: [/materialize(?:\.min)?\.(?:js|css)/i] },
    { name: 'Bulma', patterns: [/bulma(?:\.min)?\.css/i] },
    { name: 'Foundation', patterns: [/foundation(?:\.min)?\.(?:js|css)/i] },
    { name: 'Slick Carousel', patterns: [/slick(?:\.min)?\.(?:js|css)/i] },
    { name: 'Select2', patterns: [/select2(?:\.min)?\.(?:js|css)/i] },
    { name: 'Flatpickr', patterns: [/flatpickr/i] },
    { name: 'Popper.js', patterns: [/popper(?:\.min)?\.js/i] },
  ];

  const LICENSE_PATTERNS = [
    /MIT\s+[Ll]icense/,
    /Apache\s+[Ll]icense/,
    /GNU\s+(?:General|Lesser|Affero)?\s*Public\s+License/i,
    /BSD\s+[Ll]icense/,
    /Creative\s+Commons/i,
    /Mozilla\s+Public\s+License/i,
    /LGPL/,
    /GPL\s+v?\d/i,
  ];

  const CDN_HOSTS = [
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
    'unpkg.com',
    'ajax.googleapis.com',
    'code.jquery.com',
    'maxcdn.bootstrapcdn.com',
    'stackpath.bootstrapcdn.com',
    'use.fontawesome.com',
    'kit.fontawesome.com',
    'cdn.tailwindcss.com',
  ];

  const results = {
    authorAttributions: [],
    thirdPartyLibraries: [],
    licenses: [],
    cdnResources: [],
    otherIndicators: [],
  };

  // Check author/attribution patterns in raw HTML
  for (const { re, label } of AUTHOR_PATTERNS) {
    let match;
    while ((match = re.exec(allText)) !== null) {
      const value = match[1].trim().replace(/\s+/g, ' ').substring(0, 100);
      if (value.length > 1) {
        results.authorAttributions.push({ label, value });
      }
    }
  }

  // Deduplicate attributions
  results.authorAttributions = results.authorAttributions.filter(
    (item, idx, arr) => arr.findIndex(x => x.label === item.label && x.value === item.value) === idx
  );

  // Check for known libraries in script/link sources and inline HTML
  const allResources = [...scripts, ...links];
  for (const lib of KNOWN_LIBRARIES) {
    const foundIn = [];
    for (const src of allResources) {
      if (lib.patterns.some(p => p.test(src))) {
        foundIn.push(src);
      }
    }
    // Also check inline HTML for library names
    if (foundIn.length === 0 && lib.patterns.some(p => p.test(allText))) {
      foundIn.push('(inline reference)');
    }
    if (foundIn.length > 0) {
      results.thirdPartyLibraries.push({ name: lib.name, sources: foundIn });
    }
  }

  // Check for license mentions
  for (const re of LICENSE_PATTERNS) {
    if (re.test(allText)) {
      results.licenses.push(re.source.replace(/\\/g, '').replace(/\s+/g, ' '));
    }
  }

  // Check for CDN resource loading
  for (const host of CDN_HOSTS) {
    const matching = allResources.filter(r => r.includes(host));
    if (matching.length > 0) {
      results.cdnResources.push({ host, urls: matching });
    }
  }

  // Check for WordPress, Drupal, Wix, Squarespace platform indicators
  const PLATFORMS = [
    { name: 'WordPress', re: /wp-content|wp-includes|wordpress/i },
    { name: 'Drupal', re: /\/sites\/default\/files|drupal/i },
    { name: 'Wix', re: /wix\.com|wixstatic\.com/i },
    { name: 'Squarespace', re: /squarespace\.com/i },
    { name: 'Shopify', re: /cdn\.shopify\.com|myshopify\.com/i },
    { name: 'Webflow', re: /webflow\.com/i },
  ];
  for (const { name, re } of PLATFORMS) {
    if (re.test(allText)) {
      results.otherIndicators.push(`Built with ${name}`);
    }
  }

  return results;
})();
