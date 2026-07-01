#!/usr/bin/env python3
"""
Minimal Instaloader wrapper for Discord Notify's Instagram platform module.

Prints a single JSON object to stdout and always exits 0 — the Node caller
checks the "ok" field rather than parsing stderr/exit codes, so a Python
traceback never has to be scraped for error text. Never downloads media to
disk; only reads metadata over the network.

Usage:
  instaloader_fetch.py --mode posts --username NAME [--session-id ID] [--limit N]
  instaloader_fetch.py --mode stories --username NAME [--session-id ID]
"""
import argparse
import json
import os
import sys

import instaloader


def build_context(session_id):
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
    if session_id:
        L.context._session.cookies.set("sessionid", session_id, domain=".instagram.com")
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
                "thumbnail_url": item.url if not is_video else None,
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

    session_id = os.environ.get("INSTALOADER_SESSION_ID", "")
    try:
        L = build_context(session_id)
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
