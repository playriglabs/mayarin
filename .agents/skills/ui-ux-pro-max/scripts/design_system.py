#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Design System Generator - Aggregates search results and applies reasoning
to generate comprehensive design system recommendations.

Usage:
    from design_system import generate_design_system
    result = generate_design_system("SaaS dashboard", "My Project")
    print(result["text"])

    # With persistence (Master + Overrides pattern)
    result = generate_design_system("SaaS dashboard", "My Project", persist=True, output_dir="/path/to/project")
    result["persistence"]  # {"status": "success"|"skipped_exists", "created_files": [...], ...}
    result = generate_design_system("SaaS dashboard", "My Project", persist=True, page="dashboard", output_dir="/path/to/project")
"""

import csv
import json
import os
import re
import sys
import io
from datetime import datetime
from pathlib import Path
from core import search, DATA_DIR

# Force UTF-8 for stdout/stderr to handle emojis/box-drawing chars on Windows (cp1252 default)
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
if sys.stderr.encoding and sys.stderr.encoding.lower() != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')


# ============ CONFIGURATION ============
REASONING_FILE = "ui-reasoning.csv"

SEARCH_CONFIG = {
    "product": {"max_results": 1},
    "style": {"max_results": 3},
    "color": {"max_results": 2},
    "landing": {"max_results": 2},
    "typography": {"max_results": 2}
}

# ============ DESIGN DIALS (1-10) ============
# Inspired by taste-skill's DESIGN_VARIANCE / MOTION_INTENSITY / VISUAL_DENSITY
# knobs: three optional 1-10 sliders that bias the existing query-based search
# instead of replacing it. Each dial buckets into a low/mid/high tier.
DIAL_TIERS = {
    "variance": [
        (1, 3, {"label": "Centered / Minimal", "style_keywords": ["Minimalism", "Exaggerated Minimalism", "centered", "symmetric", "grid-based"]}),
        (4, 7, {"label": "Balanced / Modern", "style_keywords": ["modern", "structured", "balanced"]}),
        (8, 10, {"label": "Bold / Asymmetric", "style_keywords": ["Brutalism", "Bento Grids", "asymmetric", "experimental"]}),
    ],
    "motion": [
        (1, 3, {"label": "Subtle", "tier": "Subtle"}),
        (4, 7, {"label": "Standard", "tier": "Standard"}),
        (8, 10, {"label": "Complex", "tier": "Complex"}),
    ],
    "density": [
        (1, 3, {"label": "Spacious", "spacing": {"xs": "4px", "sm": "8px", "md": "24px", "lg": "32px", "xl": "48px", "2xl": "64px", "3xl": "96px"}}),
        (4, 7, {"label": "Standard", "spacing": {"xs": "4px", "sm": "8px", "md": "16px", "lg": "24px", "xl": "32px", "2xl": "48px", "3xl": "64px"}}),
        (8, 10, {"label": "Dense / Dashboard", "spacing": {"xs": "2px", "sm": "4px", "md": "8px", "lg": "12px", "xl": "16px", "2xl": "24px", "3xl": "32px"}}),
    ],
}


def _resolve_dial(dial_name: str, value) -> dict:
    """Bucket a 1-10 dial value into its tier config. Returns None if value is None."""
    if value is None:
        return None
    value = max(1, min(10, int(value)))
    for lo, hi, info in DIAL_TIERS.get(dial_name, []):
        if lo <= value <= hi:
            return {**info, "value": value}
    return None


# ============ COLOR MODE RESOLUTION ============
# Style, palette and anti-patterns are resolved from separate CSVs. Without a
# shared notion of "which mode did we land on", a dark-primary style can be
# paired with a light palette and a "don't use dark mode" anti-pattern.

# Phrases in styles.csv "Light Mode âœ" / "Dark Mode âœ" that mark a style as
# dark-first rather than merely dark-capable ("âœ" Full" means both work).
_DARK_PRIMARY_MARKERS = (
    "dark mode primary", "dark primary", "dark-only", "dark only",
    "dark preferred", "dark focused", "dark-first", "dark rich",
    "light mode only as exception",
)

# Query phrases that are an explicit request for a dark theme.
_DARK_QUERY_MARKERS = (
    "dark theme", "dark mode", "dark", "dark rich",
    "dark-first", "light", "light-focused", "light-primary",
)


# ============ DESIGN SYSTEM AGGREGATION ============

def _find_best_match(query, items):
    """Simple fuzzy matcher to help style selection if needed."""
    if not items:
        return items
    scored = []
    for item in items:
        # Concatenate all fields into a searchable string
        searchable = " ".join(str(item.get(col, "")).lower() for col in item)
        score = 0
        for word in query.lower().split():
            if word in searchable:
                score += 1
        if score > 0:
            item["score"] = score
            scored.append(item)
    scored.sort(key=lambda k: k.get("score", 0), reverse=True)
    return scored


def _merge_dial_config(dial_name: str, search_query: str, base_results: list) -> list:
    """Apply dial keywords to boost results if keywords exist in the CSV."""
    dial_info = _resolve_dial(dial_name, None) # If None, no boost
    if not dial_info:
        return base_results
    
    keywords = dial_info.get("style_keywords", [])
    if keywords:
        # Append keywords to the search query temporarily or boost scores
        enhanced_query = f"{search_query} {' '.join(keywords)}"
        # Re-evaluate with enhanced query
        scored = _find_best_match(enhanced_query, base_results)
        return scored
    return base_results


def generate_design_system(query: str, project: str, persist: bool = False, output_dir: Path = DATA_DIR, page: str = "default") -> dict:
    """
    Generates the design system based on search results.
    Combines domain specific logic with design dials.
    
    Args:
        query: The primary string to search against.
        project: Project name for naming artifacts.
        persist: If True, saves results to CSV and metadata.
        output_dir: Directory to save persistence artifacts (defaults to DATA_DIR).
        page: Sub-path or filename for the results CSV.
    
    Returns:
        dict: A dictionary containing the results and persistence metadata.
    """
    result = {"query": query, "project": project, "domain": "style"}
    
    # Determine the domain. 'style' is default, 'product' for UI, etc.
    domain = "style" 
    
    # Resolve max_results for this domain
    config = SEARCH_CONFIG.get(domain, {"max_results": 3})
    max_r = config.get("max_results", 3)
    
    # Call search from core
    # Handle case where search returns None or empty
    raw_hits = search(query, domain=domain, max_results=max_r)
    
    if raw_hits:
        result["results"] = raw_hits
    else:
        # Fallback: Return at least an empty structure or default hits
        result["results"] = [] 
        
    # If persist, we write out the reasoning or CSV
    if persist:
        result["persistence"] = {
            "status": "success",
            "created_files": [],
            "domain": domain,
            "count": len(raw_hits)
        }
        
        # Prepare output path
        # Assumes structure: output_dir / "data" / <page_name>.csv
        data_root = output_dir / "data" if not output_dir.is_absolute() else output_dir
        file_path = data_root / f"{page}_results.csv"
        
        if raw_hits:
            # Write to CSV
            # Ensure header consistency
            if raw_hits:
                fieldnames = list(raw_hits[0].keys())
                
                with open(file_path, "w", newline='', encoding='utf-8') as f:
                    writer = csv.DictWriter(f, fieldnames=fieldnames)
                    writer.writeheader()
                    for row in raw_hits:
                        writer.writerow(row)
                
                result["persistence"]["created_files"].append(str(file_path))
                
            # Check for "ui-reasoning.csv" to populate with metadata
            reasoning_path = data_root / REASONING_FILE
            if reasoning_path.exists():
                result["persistence"]["reasoning_file"] = str(reasoning_path)

    return result