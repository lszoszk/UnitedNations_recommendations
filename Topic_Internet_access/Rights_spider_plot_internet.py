import json
import matplotlib.pyplot as plt
import numpy as np
from collections import Counter
import math
from dateutil.parser import parse

# Load data (excluding UPR)
with open('../Data/UHRI_Internet.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
data = [r for r in data if r.get("Reccomending Body", "") != "- UPR"]

# Theme groups (4 ESC / 4 CP) & colors
theme_groups = {
    "Right to education": ["- Right to education"],
    "Right to health": ["- Right to health"],
    "Cultural rights": ["- Cultural rights"],
    "Other ESC rights": [
        "- Right to adequate housing", "- Right to food", "- Right to an adequate standard of living",
        "- Economic, social & cultural rights - general measures of implementation",
        "- Sexual & reproductive health and rights", "- Right to social security", "- Human rights & poverty",
        "- Safe drinking water & sanitation", "- Labour rights and right to work", "- Trade union rights",
        "- Land & property rights"
    ],
    "Sexual & gender-based violence": ["- Sexual & gender-based violence"],
    "Private life & privacy": ["- Private life & privacy"],
    "Freedom of expression": ["- Freedom of opinion and expression & access to information"],
    "Other civil and political rights": [
        "- Right to life", "- Rights related to marriage & family",
        "- Right to be recognized as a person before the law", "- Rights related to name, identity & nationality",
        "- Civil & political rights - general measures of implementation", "- Right to physical & moral integrity",
        "- Liberty & security of the person", "- Extrajudicial, summary or arbitrary executions", "- Death penalty",
        "- Prohibition of torture & ill-treatment (including cruel, inhuman or degrading treatment)",
        "- Conditions of detention", "- Human trafficking & contemporary forms of slavery", "- Right to peaceful assembly",
        "- Enforced disappearances", "- Arbitrary arrest & detention", "- Freedom of movement",
        "- Use of mercenaries/private security", "- Freedom of thought, conscience & religion",
        "- Freedom of association", "- Right to participate in public affairs & right to vote"
    ],
}

theme_colors = {
    "Right to education": 'darkred',
    "Right to health": 'darkred',
    "Cultural rights": 'darkred',
    "Other ESC rights": 'darkred',
    "Sexual & gender-based violence": 'darkblue',
    "Private life & privacy": 'darkblue',
    "Freedom of expression": 'darkblue',
    "Other civil and political rights": 'darkblue',
}

abbreviations = {
    "Right to education": "Education",
    "Right to health": "Health",
    "Cultural rights": "Culture",
    "Other ESC rights": "Other ESCR",
    "Sexual & gender-based violence": "Violence",
    "Private life & privacy": "Privacy",
    "Freedom of expression": "Expression",
    "Other civil and political rights": "Other CCPR",
}

def extract_year(d):
    try:
        y = parse(d, fuzzy=True).year
        return y + 2000 if y < 100 else y
    except:
        return 0

def count_themes_in_range(records, start_yr, end_yr):
    counts = {g: Counter() for g in theme_groups}
    for r in records:
        y = extract_year(r.get('Document Publication Date',''))
        if start_yr <= y <= end_yr:
            splitted = str(r.get('Themes','')).split('\n')
            for g, subs in theme_groups.items():
                for st in subs:
                    if st in splitted:
                        counts[g][st] += 1
    return counts

def get_yearly_radial_scale(y):
    if 2007 <= y <= 2011: return [10, 20, 30]
    elif 2012 <= y <= 2018: return [10, 20, 30, 40, 50, 60, 70, 80, 90]
    elif y == 2019: return [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]
    elif 2020 <= y <= 2021: return [10, 20, 30, 40, 50, 60, 70, 80, 90]
    elif 2022 <= y <= 2023: return [0, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140]
    elif y == 2024: return [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190]
    return [10, 20, 30]

def create_spider_plot_single_year(tc, yr_label, yr_int):
    lbls = list(theme_groups.keys())
    vals = np.array([sum(tc[g].values()) for g in lbls])
    N = len(lbls)
    ang = np.linspace(0, 2*np.pi, N, endpoint=False)
    vals_full = np.concatenate((vals, [vals[0]]))
    ang_full = np.concatenate((ang, [ang[0]]))

    fig, ax = plt.subplots(subplot_kw=dict(polar=True), figsize=(6,6))
    n_esc = 4
    bound = (n_esc/N)*2*np.pi
    ax.axvspan(0, bound, facecolor='lightcoral', alpha=0.2)
    ax.axvspan(bound, 2*np.pi, facecolor='lightblue', alpha=0.2)

    ax.fill(ang_full, vals_full, facecolor='lightgray', alpha=0.8)
    ax.plot(ang_full, vals_full, color='black')
    ax.set_xticks(ang)
    ax.set_xticklabels([abbreviations[g] for g in lbls])
    for tick, g in zip(ax.get_xticklabels(), lbls):
        tick.set_color(theme_colors[g])
        tick.set_fontweight('bold')

    rad_ticks = get_yearly_radial_scale(yr_int)
    ax.set_ylim(0, rad_ticks[-1])
    ax.set_yticks(rad_ticks)
    ax.set_yticklabels([str(t) for t in rad_ticks])

    esc_label_angle = bound/2
    cp_label_angle = bound + (2*np.pi - bound)/2
    radius = rad_ticks[-1]*0.8
    ax.text(esc_label_angle, radius, "ESC Rights", color='red', ha='center', va='center',
            rotation=np.degrees(esc_label_angle), rotation_mode='anchor',
            bbox=dict(boxstyle='round,pad=0.3', fc='white', alpha=0.6))
    ax.text(cp_label_angle, radius, "Civil & Political", color='blue', ha='center', va='center',
            rotation=np.degrees(cp_label_angle), rotation_mode='anchor',
            bbox=dict(boxstyle='round,pad=0.3', fc='white', alpha=0.6))

    ax.set_title(f"Theme Mentions ({yr_label})", y=1.1, fontweight='bold')
    plt.tight_layout()
    plt.show()

def create_yearly_spider_plot_grid(records, start_yr, end_yr):
    yrs = range(start_yr, end_yr+1)
    n = len(yrs)
    n_cols = 5
    n_rows = math.ceil(n / n_cols)
    fig, axs = plt.subplots(n_rows, n_cols, figsize=(4*n_cols, 4*n_rows), subplot_kw=dict(polar=True))
    axs = np.atleast_2d(axs)

    lbls = list(theme_groups.keys())
    N = len(lbls)
    n_esc = 4
    bound = (n_esc / N)*2*np.pi

    for i, y in enumerate(yrs):
        r = i // n_cols
        c = i % n_cols
        ax = axs[r,c]
        tc = count_themes_in_range(records, y, y)
        vals = np.array([sum(tc[g].values()) for g in lbls])
        ang = np.linspace(0, 2*np.pi, N, endpoint=False)
        vals_full = np.concatenate((vals, [vals[0]]))
        ang_full = np.concatenate((ang, [ang[0]]))

        ax.axvspan(0, bound, facecolor='lightcoral', alpha=0.2)
        ax.axvspan(bound, 2*np.pi, facecolor='lightblue', alpha=0.2)
        ax.fill(ang_full, vals_full, facecolor='lightgray', alpha=0.8)
        ax.plot(ang_full, vals_full, color='black')

        ax.set_xticks(ang)
        abbr_list = [abbreviations[g] for g in lbls]
        ax.set_xticklabels(abbr_list)
        for tick, g in zip(ax.get_xticklabels(), lbls):
            tick.set_color(theme_colors[g])
            tick.set_fontweight('bold')

        rt = get_yearly_radial_scale(y)
        ax.set_yticks(rt)
        ax.set_yticklabels(['']*len(rt))
        ax.set_ylim(0, rt[-1])
        ax.set_title(str(y), y=1.12, fontsize=10, fontweight='bold')

    for j in range(n, n_rows*n_cols):
        r = j // n_cols
        c = j % n_cols
        axs[r,c].set_visible(False)

    plt.tight_layout()
    plt.show()

def create_spider_plot_aggregated(tc, label):
    lbls = list(theme_groups.keys())
    stats = np.array([sum(tc[g].values()) for g in lbls])
    N = len(lbls)
    ang = np.linspace(0, 2*np.pi, N, endpoint=False)
    stats_full = np.concatenate((stats, [stats[0]]))
    ang_full = np.concatenate((ang, [ang[0]]))
    fig, ax = plt.subplots(subplot_kw=dict(polar=True), figsize=(7,7))

    n_esc = 4
    bound = (n_esc / N)*2*np.pi
    ax.axvspan(0, bound, facecolor='lightcoral', alpha=0.2)
    ax.axvspan(bound, 2*np.pi, facecolor='lightblue', alpha=0.2)

    ax.fill(ang_full, stats_full, facecolor='lightgray', alpha=0.8)
    ax.plot(ang_full, stats_full, color='black')

    ax.set_xticks(ang)
    ax.set_xticklabels(lbls)
    for tick, g in zip(ax.get_xticklabels(), lbls):
        tick.set_color(theme_colors[g])
        tick.set_fontweight('bold')

    max_val = stats.max()
    limit = max(50, int(math.ceil(max_val/50))*50)
    ticks_ = list(range(50, limit+1, 50))
    ax.set_ylim(0, limit)
    ax.set_yticks(ticks_)
    label_list = ['']*len(ticks_)
    for i in range(0, len(ticks_), 2):
        label_list[i] = str(ticks_[i])
    ax.set_yticklabels(label_list)

    ax.set_title(f"Theme Mentions: {label}", y=1.1, fontweight='bold')
    plt.tight_layout()
    plt.show()

def display_theme_counts(tc, label):
    print(f"\n=== Theme Counts: {label} ===\n")
    total = 0
    for g, ctr in tc.items():
        s = sum(ctr.values())
        total += s
        print(f"{g}: {s}")
        for st, c in ctr.items():
            print(f"  {st} => {c}")
        print()
    print(f"Grand total ({label}): {total}\n")

def create_combined_spider_plot(tc1, tc2, lbl1, lbl2):
    lbls = list(theme_groups.keys())
    stats1 = np.array([sum(tc1[g].values()) for g in lbls])
    stats2 = np.array([sum(tc2[g].values()) for g in lbls])
    N = len(lbls)
    ang = np.linspace(0, 2*np.pi, N, endpoint=False)
    s1_full = np.concatenate((stats1, [stats1[0]]))
    s2_full = np.concatenate((stats2, [stats2[0]]))
    ang_full = np.concatenate((ang, [ang[0]]))
    fig, ax = plt.subplots(subplot_kw=dict(polar=True), figsize=(7,7))

    n_esc = 4
    bound = (n_esc / N)*2*np.pi
    ax.axvspan(0, bound, facecolor='lightcoral', alpha=0.2)
    ax.axvspan(bound, 2*np.pi, facecolor='lightblue', alpha=0.2)

    ax.fill(ang_full, s1_full, facecolor='lightgrey', alpha=0.8, label=lbl1)
    ax.plot(ang_full, s1_full, color='black', linestyle='--', linewidth=1.5)
    ax.fill(ang_full, s2_full, facecolor='grey', alpha=0.8, label=lbl2)

    ax.set_xticks(ang)
    ax.set_xticklabels(lbls)
    for tick, g in zip(ax.get_xticklabels(), lbls):
        tick.set_color(theme_colors[g])
        tick.set_fontweight('bold')

    mx = max(stats1.max(), stats2.max())
    limit = max(50, int(math.ceil(mx/50))*50)
    ticks_ = list(range(50, limit+1, 50))
    ax.set_ylim(0, limit)
    ax.set_yticks(ticks_)
    label_list = ['']*len(ticks_)
    for i in range(0, len(ticks_), 2):
        label_list[i] = str(ticks_[i])
    ax.set_yticklabels(label_list)

    ax.set_title("Comparison: 2006–2020 vs 2021–2024", y=1.1, fontweight='bold')
    ax.legend(loc='upper right', bbox_to_anchor=(1.2, 1.1))
    plt.tight_layout()
    plt.show()

# Single-year spider plots (example: 2015–2024)
create_yearly_spider_plot_grid(data, 2015, 2024)

# Aggregated ranges
tc_2006_2018 = count_themes_in_range(data, 2006, 2020)
tc_2019_2024 = count_themes_in_range(data, 2021, 2024)
display_theme_counts(tc_2006_2018, "2006–2020")
create_spider_plot_aggregated(tc_2006_2018, "2006–2020")
display_theme_counts(tc_2019_2024, "2021–2024")
create_spider_plot_aggregated(tc_2019_2024, "2021–2024")

# Combined spider plot
create_combined_spider_plot(tc_2006_2018, tc_2019_2024, "2006–2019", "2020–2024")
