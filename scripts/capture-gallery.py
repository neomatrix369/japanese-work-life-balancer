"""Re-capture the UI screenshots in docs/screenshots/ from a running demo.

Usage (model + UI running, e.g. `make demo`; from the project root):
    uv run --no-project --with playwright python scripts/capture-gallery.py [UI_URL]

UI_URL defaults to http://localhost:5173. First run may need: uv run --with playwright playwright install chromium
Speech is stubbed and /tts is blocked, so nothing plays aloud. Each solve takes ~10 s; the whole run ~2 minutes.
CLI shots (docs/screenshots/01-cli/) are made separately with `freeze`; see docs/maintaining.md.
"""
import sys
from pathlib import Path

from playwright.sync_api import Browser, Page, sync_playwright

OUT = Path(__file__).resolve().parent.parent / "docs" / "screenshots"
URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173"
STUB_SPEECH = """
window.speechSynthesis = { speak(){}, cancel(){}, pause(){}, resume(){}, getVoices(){ return []; },
  speaking:false, pending:false, paused:false, addEventListener(){}, removeEventListener(){}, onvoiceschanged:null };
"""


def shot(page: Page, rel: str, full: bool = True) -> None:
    path = OUT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    page.wait_for_timeout(600)
    page.screenshot(path=str(path), full_page=full)
    print("saved", rel)


def shot_element(page: Page, selector: str, rel: str) -> None:
    page.locator(selector).scroll_into_view_if_needed()
    page.wait_for_timeout(600)
    page.locator(selector).screenshot(path=str(OUT / rel))
    print("saved", rel)


def solve(page: Page, scenario: str, preset: str) -> None:
    page.select_option("#topbar-scenario", scenario)
    page.select_option("#topbar-preset", preset)
    page.select_option("#topbar-limit", "10")
    page.get_by_role("button", name="Solve", exact=True).click()
    page.get_by_role("button", name="Stop").wait_for(state="visible", timeout=10_000)
    page.get_by_role("button", name="Solve", exact=True).wait_for(state="visible", timeout=40_000)
    page.wait_for_timeout(1500)


def new_page(browser: Browser, width: int, height: int) -> Page:
    ctx = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=2)
    ctx.add_init_script(STUB_SPEECH)
    ctx.route("**/tts", lambda r: r.abort())
    page = ctx.new_page()
    page.goto(URL)
    page.wait_for_selector("#topbar-scenario option[value='burnout']", state="attached", timeout=20_000)
    return page


def dashboard_and_details(browser: Browser) -> None:
    page = new_page(browser, 1440, 900)
    shot(page, "02-dashboard/01-landing.png", full=False)

    solve(page, "burnout", "cost-first")
    shot(page, "02-dashboard/02-burnout-cost-first.png")
    page.get_by_role("button", name="Keep this run for comparison").click()  # kept run = cost-first

    solve(page, "burnout", "health-first")
    shot(page, "02-dashboard/03-burnout-health-first.png")
    page.evaluate("document.getElementById('compare-panel').open = true")
    shot_element(page, "#compare-panel", "02-dashboard/04-compare-runs.png")
    page.evaluate("document.getElementById('replay-bar').open = true")
    shot_element(page, "#replay-bar", "02-dashboard/05-solver-replay.png")

    page.evaluate("window.scrollTo(0, 0)")
    page.locator(".kpi-info-btn").first.click()
    shot(page, "03-details/06-kpi-explainer.png", full=False)
    page.locator(".kpi-info-btn").first.click()

    page.locator(".week-grid tbody tr").first.click()
    page.wait_for_timeout(800)
    shot(page, "03-details/07-employee-panel.png", full=False)
    page.locator(".side-panel-overlay").click(position={"x": 20, "y": 20})
    page.locator(".side-panel-overlay").wait_for(state="detached", timeout=5_000)

    page.select_option("#topbar-role", "HR")
    page.select_option("#topbar-currency", "GBP")
    page.get_by_text("Longevity", exact=False).first.scroll_into_view_if_needed()
    shot(page, "03-details/08-longevity-hr-gbp.png", full=False)

    solve(page, "overloaded", "health-first")
    page.locator("text=Broken Constraints").first.scroll_into_view_if_needed()
    shot(page, "03-details/09-overloaded-broken-constraints.png", full=False)
    page.context.close()


def themes_and_mobile(browser: Browser) -> None:
    dark = new_page(browser, 1440, 900)
    dark.get_by_role("button", name="Dark theme").click()  # the app keeps its own theme, not the OS setting
    solve(dark, "burnout", "health-first")
    dark.select_option("#topbar-currency", "GBP")
    shot(dark, "04-themes-and-mobile/10-dark-theme.png", full=False)
    dark.context.close()

    mobile = new_page(browser, 390, 844)
    solve(mobile, "burnout", "health-first")
    shot(mobile, "04-themes-and-mobile/11-mobile-390.png", full=False)
    mobile.context.close()


def tour(browser: Browser) -> None:
    page = new_page(browser, 1440, 900)
    page.get_by_role("button", name="Play demo").click()
    page.wait_for_selector(".tour-root", timeout=10_000)
    page.wait_for_timeout(2500)
    shot(page, "05-tour/12-tour-intro.png", full=False)
    page.keyboard.press("ArrowRight")  # step 2 starts the cost-first solve
    page.wait_for_timeout(4000)
    shot(page, "05-tour/13-tour-step.png", full=False)
    page.keyboard.press("Escape")
    page.context.close()


if __name__ == "__main__":
    with sync_playwright() as p:
        b = p.chromium.launch()
        dashboard_and_details(b)
        themes_and_mobile(b)
        tour(b)
        b.close()
