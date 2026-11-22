"""Pack the HTML launch documents selected by Duck's community catalog.

Run after refreshing data/community-games.json. Uses the Python standard library.
Pass --cache-dir PATH to reuse downloaded source archives when retrying an import.
"""

import argparse
import concurrent.futures
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tempfile
import time
from urllib.parse import unquote, urlsplit
from urllib.request import Request, urlopen
from zipfile import ZipFile, is_zipfile

ROOT = Path(__file__).resolve().parents[1]
REPOS = {
    "GN-MATH": ("gn-math/html", "gn", "/html/"),
    "CKV": ("WanoCapy/ChickenKingsVault", "ckv", "/ChickenKingsVault/"),
    "UGS": ("bubbls/ugs-singlefile", "ugs", "/gh/bubbls/ugs-singlefile@main/"),
}
CHUNK = 24 * 1024 * 1024
EMBEDDED_GAME = re.compile(rb'<iframe\b[^>]*?\bid=["\']gameFrame["\'][^>]*?\bsrc=["\']([^"\']+)["\']', re.I)


# These releases contain only the CKV analytics header. Keep their original URLs
# and serve the matching complete edition when the stub is still present.
CKV_FALLBACKS = {
    "ckv:2048game.html": "truffled:games/2048/index.html",
    "ckv:amongus.html": "ugs:clamongus.html",
    "ckv:soccerrandom.html": "gn:739",
    "ckv:drawclimber.html": "gn:86",
    "ckv:fireboyandwatergirl2.html": "gn:88",
    "ckv:fireboyandwatergirl3.html": "gn:89",
    "ckv:breakingthebank.html": "ugs:clstickminbreakingbank.html",
    "ckv:threegoblets.html": "gn:620",
}

class MissingGnBuild(ValueError):
    """A CKV wrapper contains a CDN error naming its original GN build."""


def valid_html(data):
    # Some titles begin with a script, a comment, plain text or an UTF-8 BOM.
    return bool(data) and b"<" in data[:32000] and data[:256].count(b"\0") < 8


def request(url):
    return urlopen(Request(url, headers={"User-Agent": "Duck-Game-Library/1.0"}), timeout=45)


def repository_archive(provider, cache):
    repo, slug, _ = REPOS[provider]
    target = cache / f"duck-launch-{slug}.zip"
    if not is_zipfile(target):
        tmp = target.with_suffix(".partial")
        print(f"Downloading {repo}", flush=True)
        with request(f"https://codeload.github.com/{repo}/zip/refs/heads/main") as response, tmp.open("wb") as out:
            shutil.copyfileobj(response, out, length=1024 * 1024)
        if not is_zipfile(tmp):
            raise ValueError(f"Incomplete archive from {repo}")
        os.replace(tmp, target)
    return ZipFile(target)


def from_archive(item, archive):
    url_path = unquote(urlsplit(item["url"]).path)
    prefix = REPOS[item["provider"]][2]
    if not url_path.startswith(prefix):
        raise ValueError(f"Unexpected repository URL: {item['url']}")
    member = archive.infolist()[0].filename + url_path[len(prefix):]
    html = archive.read(member)
    if item["provider"] == "CKV":
        # The catalog usually points to CKV's toolbar surrounding a sibling game file.
        embedded = EMBEDDED_GAME.search(html)
        if embedded:
            filename = unquote(embedded[1].decode("utf8"))
            if "/" not in filename and "\\" not in filename and filename.lower().endswith(".html"):
                sibling = str(PurePosixPath(member).parent / filename)
                if sibling in archive.NameToInfo:
                    html = archive.read(sibling)
    if html.startswith((b"\xff\xfe", b"\xfe\xff")):
        html = html.decode("utf-16").encode("utf8")
    if not valid_html(html):
        missing = re.fullmatch(rb"Couldn't find the requested file /(\d+)\.html in gn-math/html\.\s*", html)
        if item["provider"] == "CKV" and missing:
            raise MissingGnBuild("gn:" + missing[1].decode("ascii"))
        raise ValueError(f"Invalid game document: {member}")
    return html


def truffled_document(item, cache):
    url = item["url"]
    cache_file = cache / (hashlib.sha256(url.encode()).hexdigest() + ".html")
    if cache_file.is_file() and valid_html(cache_file.read_bytes()):
        return cache_file
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.netloc != "truffled.lol" or not parts.path.startswith(("/games/", "/gamefile/")):
        raise ValueError("Unexpected Truffled launch URL")
    for attempt in range(3):
        try:
            with request(url) as response:
                final = urlsplit(response.geturl())
                if final.netloc != parts.netloc or not final.path.startswith(("/games/", "/gamefile/")):
                    raise ValueError(f"Launch URL redirected to {final.path}")
                html = response.read()
                if not valid_html(html):
                    raise ValueError("Source did not return a game document")
            temporary = cache_file.with_suffix(".partial")
            temporary.write_bytes(html)
            os.replace(temporary, cache_file)
            return cache_file
        except (OSError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(1 + attempt)


def fetch_truffled(games, cache):
    cache.mkdir(exist_ok=True, parents=True)
    local = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        jobs = {pool.submit(truffled_document, item, cache): item["url"] for item in games}
        for future in concurrent.futures.as_completed(jobs):
            url = jobs[future]
            local[url] = future.result()
            if len(local) % 100 == 0:
                print(f"Read {len(local)} Truffled documents", flush=True)
    return local


class PackWriter:
    def __init__(self, output):
        self.output = output
        self.alternates = {}
        self.packs = []
        self.entries = {}
        self.chunks = bytearray()
        self.locations = {}

    def flush(self):
        if not self.chunks:
            return
        digest = hashlib.sha256(self.chunks).hexdigest()
        name = f"{digest}.pack"
        target = self.output / name
        with tempfile.NamedTemporaryFile(dir=self.output, delete=False) as staging:
            staging.write(self.chunks)
        os.replace(staging.name, target)
        self.packs.append(name)
        self.chunks.clear()

    def add(self, url, html):
        key = hashlib.sha256(html).digest()
        if key not in self.locations:
            data = gzip.compress(html, compresslevel=6, mtime=0)
            if len(self.chunks) + len(data) > CHUNK:
                self.flush()
            self.locations[key] = [len(self.packs), len(self.chunks), len(data), len(html)]
            self.chunks.extend(data)
        self.entries[url] = self.locations[key]

    def finish(self, revisions):
        self.flush()
        index = {"revisions": revisions, "alternates": self.alternates, "packs": self.packs, "entries": self.entries}
        with tempfile.NamedTemporaryFile(dir=self.output, mode="w", encoding="utf8", delete=False) as out:
            json.dump(index, out, ensure_ascii=False, separators=(",", ":"))
        os.replace(out.name, self.output / "index.json")


def build(cache):
    games = json.loads((ROOT / "data/community-games.json").read_text(encoding="utf8"))["games"]
    games = sorted((row for row in games if row.get("launchMode") != "external"), key=lambda row: row["url"])
    truffled = [row for row in games if row["provider"] == "TRUFFLED"]
    output = ROOT / "data/game-documents"
    output.mkdir(exist_ok=True, parents=True)
    writer = PackWriter(output)
    by_id = {item["id"]: item for item in games}
    revisions = {}
    incomplete = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        fetching = pool.submit(fetch_truffled, truffled, cache / "duck-truffled-documents")
        for provider in REPOS:
            with repository_archive(provider, cache) as archive:
                selected = [item for item in games if item["provider"] == provider]
                for item in selected:
                    try:
                        html = from_archive(item, archive)
                        writer.add(item["url"], html)
                        if item["id"] in CKV_FALLBACKS and len(html) < 1000 and b"<body" not in html.lower():
                            incomplete[item["url"]] = CKV_FALLBACKS[item["id"]]
                    except MissingGnBuild as missing:
                        original_url = by_id[str(missing)]["url"]
                        writer.entries[item["url"]] = writer.entries[original_url]
                        writer.alternates[item["url"]] = original_url
                revisions[provider] = archive.comment.decode("ascii")
                print(f"Packed {len(selected)} {provider} documents", flush=True)
        paths = fetching.result()
        for item in truffled:
            writer.add(item["url"], paths[item["url"]].read_bytes())
    for url, alternate_id in incomplete.items():
        alternate = by_id[alternate_id]["url"]
        writer.entries[url] = writer.entries[alternate]
        writer.alternates[url] = alternate
    if len(writer.entries) != len(games):
        raise ValueError("Catalog count did not match packed game count")
    writer.finish(revisions)
    print(f"Packed {len(writer.entries)} game documents into {len(writer.packs)} files.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path)
    args = parser.parse_args()
    if args.cache_dir:
        args.cache_dir.mkdir(exist_ok=True, parents=True)
        build(args.cache_dir)
    else:
        with tempfile.TemporaryDirectory(prefix="duck-archives-") as temporary:
            build(Path(temporary))
