import sys

path = '/Users/rn/clerking-site/public/index.html'

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

original_len = len(content)

# Fix 1 — Remove dev comment
old1 = '<!-- UPDATE: Replace rn@rncollins.com throughout with your actual contact email before going live -->'
count1_before = content.count(old1)
content = content.replace(old1, '', 1)
print(f'Fix 1: found {count1_before} instance(s), removed.')

# Fix 2 — Add SEO meta tags
old2 = '<meta name="description" content="Clerking connects solo and small firm attorneys with supervised law students for research, drafting, and document review — nationally, at $30–45/hr.">'
new2 = (
    '<meta name="description" content="Clerking connects solo and small firm attorneys with supervised law students for research, drafting, and document review — nationally, at $30–45/hr.">\n'
    '<link rel="canonical" href="https://clerking-site.vercel.app/">\n'
    '<link rel="icon" href="data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'><text y=\'.9em\' font-size=\'90\'>⚖️</text></svg>">\n'
    '<meta property="og:type" content="website">\n'
    '<meta property="og:url" content="https://clerking-site.vercel.app/">\n'
    '<meta property="og:title" content="Clerking — Fractional Law Clerk Marketplace">\n'
    '<meta property="og:description" content="Clerking connects solo and small firm attorneys with supervised law students for research, drafting, and document review — nationally, at $30–45/hr.">\n'
    '<meta name="twitter:card" content="summary">\n'
    '<meta name="twitter:title" content="Clerking — Fractional Law Clerk Marketplace">\n'
    '<meta name="twitter:description" content="Clerking connects solo and small firm attorneys with supervised law students for research, drafting, and document review — nationally, at $30–45/hr.">'
)
count2_before = content.count(old2)
content = content.replace(old2, new2, 1)
print(f'Fix 2: found {count2_before} instance(s), replaced.')

# Fix 3 — Add skip-link CSS before first </style>
skip_css = '.skip-link{position:absolute;left:-9999px;top:4px;z-index:9999;background:#3b82f6;color:#fff;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none}.skip-link:focus{left:4px}'
content = content.replace('</style>', skip_css + '\n</style>', 1)
print('Fix 3: skip-link CSS inserted before first </style>.')

# Fix 4 — Add mobile hamburger CSS before </style> (second occurrence = first </style> after fix 3)
hamburger_css = (
    '.nav-hamburger{display:none;flex-direction:column;gap:5px;background:none;border:none;cursor:pointer;padding:6px}'
    '.nav-hamburger span{display:block;width:22px;height:2px;background:#94a3b8;border-radius:2px;transition:all .2s}'
    '.nav-hamburger:hover span{background:#e2e8f0}'
    '.mobile-nav{display:none;position:absolute;top:100%;left:0;right:0;background:#111827;border-top:1px solid #1e293b;padding:1rem 1.5rem;flex-direction:column;gap:.25rem;z-index:200}'
    '.mobile-nav a{color:#94a3b8;font-size:14px;font-weight:500;padding:.6rem 0;border-bottom:1px solid #1e293b;display:block}'
    '.mobile-nav a:last-child{border-bottom:none}'
    '.mobile-nav a.mobile-cta{background:#3b82f6;color:#fff!important;padding:10px 16px;border-radius:7px;text-align:center;margin-top:.5rem;border-bottom:none;display:block}'
    '@media(max-width:768px){.nav-links{display:none}.nav-hamburger{display:flex}.mobile-nav.open{display:flex}nav{position:relative}}'
)
content = content.replace('</style>', hamburger_css + '\n</style>', 1)
print('Fix 4: hamburger CSS inserted.')

# Fix 5 — Add skip link before announce div
old5 = '<div class="announce">'
new5 = '<a href="#main-content" class="skip-link">Skip to main content</a><div class="announce">'
count5 = content.count(old5)
content = content.replace(old5, new5, 1)
print(f'Fix 5: found {count5} instance(s), skip link added.')

# Fix 6 — Wrap content in <main>
old6a = '<section class="section" id="attorneys">'
new6a = '<main id="main-content"><section class="section" id="attorneys">'
count6a = content.count(old6a)
content = content.replace(old6a, new6a, 1)
print(f'Fix 6a: found {count6a} instance(s), <main> opened.')

old6b = '<footer>'
new6b = '</main><footer>'
count6b = content.count(old6b)
content = content.replace(old6b, new6b, 1)
print(f'Fix 6b: found {count6b} instance(s), </main> closed before footer.')

# Fix 7 — Add mobile hamburger button before </nav>
old7 = '</nav>'
new7 = (
    '<button class="nav-hamburger" aria-label="Open navigation menu" aria-expanded="false" id="nav-toggle" onclick="toggleMobileNav(this)">'
    '<span></span><span></span><span></span>'
    '</button>'
    '<div class="mobile-nav" id="mobile-nav">'
    '<a href="#attorneys" onclick="closeMobileNav()">For attorneys</a>'
    '<a href="#what-clerks-do" onclick="closeMobileNav()">What clerks do</a>'
    '<a href="#pricing" onclick="closeMobileNav()">Pricing</a>'
    '<a href="#students" onclick="closeMobileNav()">For students</a>'
    '<a href="#about" onclick="closeMobileNav()">About</a>'
    '<a href="#faq" onclick="closeMobileNav()">FAQ</a>'
    '<a href="mailto:rn@rncollins.com?subject=Clerking — Get Started" class="mobile-cta">Join the waitlist</a>'
    '</div>'
    '</nav>'
)
count7 = content.count(old7)
content = content.replace(old7, new7, 1)
print(f'Fix 7: found {count7} instance(s) of </nav>, hamburger button added.')

# Fix 8 — Add mobile nav JS before last </script>
js_code = (
    "function toggleMobileNav(btn){"
    "var nav=document.getElementById('mobile-nav');"
    "var open=nav.classList.toggle('open');"
    "btn.setAttribute('aria-expanded',open);"
    "btn.setAttribute('aria-label',open?'Close navigation menu':'Open navigation menu');}"
    "function closeMobileNav(){"
    "document.getElementById('mobile-nav').classList.remove('open');"
    "var btn=document.getElementById('nav-toggle');"
    "if(btn){btn.setAttribute('aria-expanded','false');"
    "btn.setAttribute('aria-label','Open navigation menu');}}"
)
last_script_idx = content.rfind('</script>')
if last_script_idx != -1:
    content = content[:last_script_idx] + js_code + '\n</script>' + content[last_script_idx+9:]
    print('Fix 8: mobile nav JS inserted before last </script>.')
else:
    print('Fix 8: ERROR - </script> not found!')

# Fix 9 — Remove duplicate FAQ item
old9 = (
    ' <div class="faq-item">'
    ' <button class="faq-q" aria-expanded="false">'
    ' <span class="faq-q-text">What if the match isn\'t working in the first two weeks?</span>'
    ' <span class="faq-icon" aria-hidden="true">+</span>'
    ' </button>'
    ' <div class="faq-a"><div class="faq-a-inner">Reach out within the first two weeks and we\'ll rematch you at no additional charge.'
    ' Our goal is a match that works — we\'d rather take the time to get it right.'
    ' If a specific practice area focus, student year, or communication style isn\'t landing, tell us specifically and we\'ll adjust.'
    '</div></div>'
    ' </div>'
)
count9 = content.count(old9)
content = content.replace(old9, '', 1)
print(f'Fix 9: found {count9} instance(s) of duplicate FAQ, removed.')

# Fix 10 — Fix copy contradiction
old10 = 'Resource students can apply directly to visible job board postings. No placement is guaranteed'
new10 = 'No placement is guaranteed'
count10 = content.count(old10)
content = content.replace(old10, new10, 1)
print(f'Fix 10: found {count10} instance(s), copy contradiction fixed.')

# Fix 11 — Replace developer photo placeholder
old11 = (
    '<!-- UPDATE: Replace with your actual photo -->'
    ' <div class="about-photo-wrap">'
    ' <p>[ Photo of<br>Rayven-Nikkita Collins ]</p>'
    ' <p style="font-size:11px;color:#334155">Update src with your photo</p>'
    ' </div>'
)
new11 = (
    '<div class="about-photo-wrap" style="background:#1e293b;display:flex;align-items:center;justify-content:center;border-radius:12px;min-height:300px;overflow:hidden;">'
    '<div style="text-align:center;color:#475569;font-size:13px;padding:20px;">'
    '<div style="font-size:64px;margin-bottom:12px;opacity:.4;">&#9878;</div>'
    '<div style="font-weight:600;color:#64748b;font-size:14px;">RN Collins</div>'
    '<div style="font-size:11px;color:#334155;margin-top:4px;">Photo coming soon</div>'
    '</div></div>'
)
count11 = content.count(old11)
content = content.replace(old11, new11, 1)
print(f'Fix 11: found {count11} instance(s), photo placeholder replaced.')

# Verification
print()
print('=== VERIFICATION REPORT ===')
checks = [
    ('og:title present', 'og:title' in content, True),
    ('canonical present', 'canonical' in content, True),
    ('skip-link present', 'skip-link' in content, True),
    ('nav-hamburger present', 'nav-hamburger' in content, True),
    ('UPDATE: Replace NOT present', 'UPDATE: Replace' not in content, True),
    ('Update src with your photo NOT present', 'Update src with your photo' not in content, True),
    ('main id= present', 'main id=' in content, True),
]
all_pass = True
for label, result, expected in checks:
    status = 'PASS' if result == expected else 'FAIL'
    if status == 'FAIL':
        all_pass = False
    print(f'  [{status}] {label}: {result}')

faq_count = content.count("What if the match isn't working in the first two weeks")
faq_ok = faq_count == 0
status = 'PASS' if faq_ok else 'FAIL'
if not faq_ok:
    all_pass = False
print(f'  [{status}] Duplicate FAQ count == 0: count={faq_count}')

print(f'File length: {original_len} -> {len(content)} (delta {len(content)-original_len:+d})')
print()
if all_pass:
    print('All checks passed. Saving file...')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('File saved successfully.')
else:
    print('Some checks FAILED. File NOT saved. Review output above.')
    sys.exit(1)
