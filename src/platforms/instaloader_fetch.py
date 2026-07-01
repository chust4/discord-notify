#!/usr/bin/env python3
"""
Minimal Instaloader wrapper for Discord Notify's Instagram platform module.

Prints a single JSON object to stdout and always exits 0 — the Node caller
checks the "ok" field rather than parsing stderr/exit codes, so a Python
traceback never has to be scraped for error text. Never downloads media to
disk; only reads metadata over the network.

The session is read from the INSTALOADER_SESSION_ID env var as a JSON object
with "sessionid", "csrftoken" and "ds_user_id" keys (all three are required —
see build_context() for why a bare sessionid is not enough).

Usage:
  instaloader_fetch.py --mode posts --username NAME [--limit N]
  instaloader_fetch.py --mode stories --username NAME
"""
import argparse
import json
import os
import sys

import instaloader

REQUIRED_COOKIES = ("sessionid", "csrftoken", "ds_user_id")


def build_context(session_json):
    L = instaloader.Instaloader(
        quiet=True,
        download_pictures=False,
        download_videos=False,
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
        max_connection_attempts=1,
    )
    if not session_json:
        return L

    # Instagram's GraphQL endpoint requires more than a bare `sessionid`:
    # Instaloader's own load_session() also needs `csrftoken` (sent as the
    # X-CSRFToken header on every query) and sets `context.username` from
    # the id we pass in, which flips `context.is_logged_in` to True and
    # unlocks several logged-in-only code paths inside the library. Manually
    # poking just a `sessionid` cookie onto an anonymous session (the
    # previous approach here) leaves both of those unset and gets a plain
    # 403 back from Instagram — confirmed against Instaloader's own source.
    try:
        session = json.loads(session_json)
        if not isinstance(session, dict):
            session = {}
    except (TypeError, ValueError):
        # Backward-compat: a bare (non-JSON) value is treated as just the
        # sessionid, so the resulting error correctly names only the *other*
        # two cookies as missing instead of claiming all three are absent.
        session = {"sessionid": session_json}
    missing = [k for k in REQUIRED_COOKIES if not session.get(k)]
    if missing:
        raise RuntimeError(
            "niekompletna sesja Instagram — brakuje: " + ", ".join(missing) +
            " (zaktualizuj wtyczkę przeglądarki i zsynchronizuj ponownie, albo wklej pełny JSON w panelu)"
        )
    L.context.load_session(session["ds_user_id"], {k: session[k] for k in REQUIRED_COOKIES})
    # Instagram's newer `xdt_api__v1__...` GraphQL queries (used for the
    # logged-in post-timeline listing) appear to require this header, which
    # Instaloader does not set by default. It is Instagram's public web app
    # client id — the same well-known constant other Instagram tools (e.g.
    # yt-dlp's extractor) send. Harmless to include; Stories detection does
    # not need it and is unaffected either way.
    L.context._session.headers.update({"X-IG-App-ID": "936619743392459"})
    return L


def safe_video_url(obj):
    # .video_url can require an extra full-metadata request per item; never
    # let that fail the whole item, and never pay that cost for photo items.
    try:
        return obj.video_url if getattr(obj, "is_video", False) else None
    except Exception:
        return None


def post_item(post):
    is_video = bool(post.is_video)
    shortcode_path = "reel" if is_video else "p"
    return {
        "id": str(post.mediaid),
        "url": f"https://www.instagram.com/{shortcode_path}/{post.shortcode}/",
        "title": (post.caption or "")[:200],
        "thumbnail_url": post.url,
        "video_url": safe_video_url(post),
        "timestamp": int(post.date_utc.timestamp()),
        "duration": int(post.video_duration) if is_video and post.video_duration else None,
        "is_video": is_video,
    }


def fetch_posts(L, username, limit):
    profile = instaloader.Profile.from_username(L.context, username)
    items = []
    for post in profile.get_posts():
        items.append(post_item(post))
        if len(items) >= limit:
            break
    return items


def fetch_stories(L, username):
    profile = instaloader.Profile.from_username(L.context, username)
    items = []
    for story in L.get_stories(userids=[profile.userid]):
        for item in story.get_items():
            is_video = bool(item.is_video)
            items.append({
                "id": str(item.mediaid),
                "url": item.url,
                "title": None,
                # .url is documented as "URL of the picture / video thumbnail"
                # — always a still image, even for video items (the actual
                # video file is the separate .video_url captured below). No
                # is_video branching needed/correct here.
                "thumbnail_url": item.url,
                "video_url": safe_video_url(item),
                "timestamp": int(item.date_utc.timestamp()),
                "duration": None,
                "is_video": is_video,
            })
    return items


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--mode", choices=["posts", "stories"], required=True)
    p.add_argument("--username", required=True)
    p.add_argument("--limit", type=int, default=12)
    args = p.parse_args()

    session_json = os.environ.get("INSTALOADER_SESSION_ID", "")
    try:
        L = build_context(session_json)
        if args.mode == "posts":
            items = fetch_posts(L, args.username, args.limit)
        else:
            items = fetch_stories(L, args.username)
        print(json.dumps({"ok": True, "items": items}))
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"[:500]}))
    sys.exit(0)


if __name__ == "__main__":
    main()
