#!/usr/bin/env python3
"""Regenerates the README / deck screenshots from a running ssa_server (needs: pip install playwright).

    python3 tools/screenshots.py [--url http://localhost:8080] [--out docs/screenshots]
"""
import argparse
import os

from playwright.sync_api import sync_playwright


def apply_demo_filters(page):
    page.fill("#q", "smith")
    page.get_by_role("button", name="All states & territories").click()
    for code in ("MD", "VA", "DC"):
        page.locator(f"#st-{code}").check()
    page.locator("#q").click()  # close the popover
    page.get_by_role("button", name="Retirement", exact=True).click()
    hdr = page.locator("th", has_text="Monthly benefit")
    hdr.click()
    hdr.click()  # descending


def settle(page, crosscheck=True):
    page.wait_for_timeout(600)
    page.wait_for_function("!document.body.innerText.includes('Computing aggregates')", timeout=60000)
    if crosscheck:
        page.wait_for_function("document.body.innerText.includes('identical page')", timeout=60000)
    page.mouse.move(2, 2)  # no hover highlight in the capture
    page.wait_for_timeout(300)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8080")
    ap.add_argument("--out", default="docs/screenshots")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.add_init_script("try { localStorage.setItem('ssa-theme', '3270') } catch (e) {}")

        page.goto(a.url)
        page.wait_for_selector("table tbody tr", timeout=60000)
        apply_demo_filters(page)
        settle(page)
        page.screenshot(path=os.path.join(a.out, "engine-crosscheck.png"), full_page=True)

        page.get_by_role("button", name="PostgreSQL").click()
        settle(page)
        page.screenshot(path=os.path.join(a.out, "postgres-backend.png"), full_page=True)

        page.get_by_role("button", name="C++ engine").click()
        page.get_by_role("button", name="Standard").click()
        settle(page)
        page.screenshot(path=os.path.join(a.out, "standard-theme.png"), full_page=True)
        browser.close()
    print("wrote", ", ".join(sorted(f for f in os.listdir(a.out) if f.endswith(".png"))))
    print("browser errors:", errors or "none")


if __name__ == "__main__":
    main()
