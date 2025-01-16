import json
import matplotlib.pyplot as plt
from dateutil.parser import parse
import random
import numpy as np
from matplotlib.lines import Line2D

# ----------------------------------------------------------------------
# 1) Load JSON data, remove UPR records
# ----------------------------------------------------------------------
file_path = "../Data/UHRI_Internet.json"
with open(file_path, "r", encoding="utf-8") as f:
    data_records = json.load(f)

data_records = [
    r for r in data_records
    if r.get("Reccomending Body", "") != "- UPR"
]

# ----------------------------------------------------------------------
# 2) Define subthemes, color map, numeric labels
# ----------------------------------------------------------------------
esc_ccpr_subthemes = {
    "1) Right to education": ["- Right to education"],
    "2) Right to health": ["- Right to health"],
    "3) Labour rights": ["- Labour rights and right to work", "- Trade union rights"],
    "4) Cultural rights": ["- Cultural rights"],
    "5) Other ESCR": [
        "- Right to adequate housing", "- Right to food",
        "- Right to an adequate standard of living",
        "- Economic, social & cultural rights - general measures of implementation",
        "- Sexual & reproductive health and rights", "- Right to social security",
        "- Human rights & poverty", "- Safe drinking water & sanitation",
        "- Land & property rights",
    ],
    "6) Freedom of expression": ["- Freedom of opinion and expression & access to information"],
    "7) Right to privacy": ["- Private life & privacy"],
    "8) Sexual violence": ["- Sexual & gender-based violence"],
    "9) Right to public participation": [
        "- Right to participate in public affairs & right to vote",
        "- Right to peaceful assembly", "- Freedom of association"
    ],
    "10) Other CCPR rights": [
        "- Right to life",
        "- Civil & political rights - general measures of implementation",
        "- Right to physical & moral integrity", "- Liberty & security of the person",
        "- Prohibition of torture & ill-treatment (including cruel, inhuman or degrading treatment)",
        "- Conditions of detention", "- Arbitrary arrest & detention",
        "- Enforced disappearances", "- Freedom of movement",
    ],
}

esc_ccpr_color_map = {
    "1) Right to education": "red", "2) Right to health": "red", "3) Labour rights": "red",
    "4) Cultural rights": "red", "5) Other ESCR": "red",
    "6) Freedom of expression": "blue", "7) Right to privacy": "blue",
    "8) Sexual violence": "blue", "9) Right to public participation": "blue",
    "10) Other CCPR rights": "blue",
}

esc_ccpr_numeric_label = {
    "1) Right to education": "1",
    "2) Right to health": "2",
    "3) Labour rights": "3",
    "4) Cultural rights": "4",
    "5) Other ESCR": "5",
    "6) Freedom of expression": "6",
    "7) Right to privacy": "7",
    "8) Sexual violence": "8",
    "9) Right to public participation": "9",
    "10) Other CCPR rights": "10",
}

# ----------------------------------------------------------------------
# 3) Count mentions for each subtheme by year (2007–2024)
# ----------------------------------------------------------------------
all_years_range = range(2007, 2025)
yearly_esc_ccpr_counts = {yr: {cat: 0 for cat in esc_ccpr_subthemes} for yr in all_years_range}

for r in data_records:
    pub_date = (r.get("Document Publication Date") or "").strip()
    if not pub_date:
        continue
    try:
        y = parse(pub_date, fuzzy=True).year
        if y < 100: y += 2000
    except:
        continue
    if 2007 <= y <= 2024:
        splitted = str(r.get("Themes", "")).split("\n")
        for cat, subs in esc_ccpr_subthemes.items():
            for st in subs:
                if st in splitted:
                    yearly_esc_ccpr_counts[y][cat] += 1

# ----------------------------------------------------------------------
# 4) Dot Plot (2014–2024)
# ----------------------------------------------------------------------
years_range = range(2014, 2025)
plot_data = {
    cat: [yearly_esc_ccpr_counts[yr][cat] for yr in years_range]
    for cat in esc_ccpr_subthemes
}

fig, ax = plt.subplots(figsize=(12, 8))
x_vals = np.arange(len(years_range)) + 0.5
ax.set_xticks(x_vals)
ax.set_xticklabels(years_range, rotation=45)
ax.set_xlim(0, len(years_range))
for i in range(len(years_range) + 1):
    ax.axvline(x=i, color='lightgrey', linestyle='--', linewidth=1, alpha=0.7)

random.seed(42)
markersize_ = 12
fontsize_ = 8

for cat in esc_ccpr_subthemes:
    color_ = esc_ccpr_color_map[cat]
    label_ = esc_ccpr_numeric_label[cat]
    counts_ = plot_data[cat]
    for i, count in enumerate(counts_):
        jx = x_vals[i] + random.uniform(-0.3, 0.3)
        ax.plot(jx, count, marker='o', color=color_, markersize=markersize_, linestyle='', alpha=0.6)
        ax.text(jx, count, label_, color='white', ha='center', va='center', fontsize=fontsize_, fontweight='bold')

ax.set_xlabel("Year")
ax.set_ylabel("Number of Mentions")
ax.set_title("Frequency of ESC/CCPR Rights Mentions (2014–2024)")

legend_elements = []
for cat in esc_ccpr_subthemes:
    legend_elements.append(
        Line2D([0], [0], marker='o', color=esc_ccpr_color_map[cat],
               label=f"{esc_ccpr_numeric_label[cat]} - {cat[3:]}", markersize=markersize_, linestyle='')
    )
ax.legend(handles=legend_elements, title="Human Rights", loc="upper left", fontsize=9)

plt.tight_layout()
plt.show()

# ----------------------------------------------------------------------
# 5) Stacked Bar Chart (2007–2024)
# ----------------------------------------------------------------------
esc_categories = [
    "1) Right to education", "2) Right to health", "3) Labour rights",
    "4) Cultural rights", "5) Other ESCR"
]
ccpr_categories = [
    "6) Freedom of expression", "7) Right to privacy", "8) Sexual violence",
    "9) Right to public participation", "10) Other CCPR rights"
]

years_range_extended = range(2007, 2025)
ext_esc_counts = []
ext_ccpr_counts = []

for yr in years_range_extended:
    esc_sum = sum(yearly_esc_ccpr_counts[yr][c] for c in esc_categories)
    ccpr_sum = sum(yearly_esc_ccpr_counts[yr][c] for c in ccpr_categories)
    ext_esc_counts.append(esc_sum)
    ext_ccpr_counts.append(ccpr_sum)

tot_ext = [e + c for e, c in zip(ext_esc_counts, ext_ccpr_counts)]
ext_esc_pct = [100 * e / t if t else 0 for e, t in zip(ext_esc_counts, tot_ext)]
ext_ccpr_pct = [100 * c / t if t else 0 for c, t in zip(ext_ccpr_counts, tot_ext)]

fig, ax = plt.subplots(figsize=(14, 7))
bar1 = ax.bar(years_range_extended, ext_esc_counts, color="red", label="ESC Rights", alpha=0.9)
bar2 = ax.bar(years_range_extended, ext_ccpr_counts, bottom=ext_esc_counts, color="blue", label="CCPR Rights", alpha=0.9)

for i, (b1, b2) in enumerate(zip(bar1, bar2)):
    if tot_ext[i] > 0:
        ax.text(
            b1.get_x() + b1.get_width()/2, b1.get_height()/2,
            f"{ext_esc_pct[i]:.1f}%", ha="center", va="center", fontsize=9, color="white"
        )
        ax.text(
            b2.get_x() + b2.get_width()/2, b2.get_y() + b2.get_height()/2,
            f"{ext_ccpr_pct[i]:.1f}%", ha="center", va="center", fontsize=9, color="white"
        )

ax.set_title("Stacked Bar Chart of ESC vs CCPR Rights Mentions (2007–2024)")
ax.set_xlabel("Year")
ax.set_ylabel("Number of Mentions")
ax.set_xticks(years_range_extended)
ax.set_xticklabels(years_range_extended, rotation=45)
ax.legend(loc="upper left")

plt.tight_layout()
plt.show()

# ----------------------------------------------------------------------
# 6) Limited Stacked Bar Chart (2009–2024) with selective CCPR percentages
# ----------------------------------------------------------------------
yrs_lim = range(2009, 2025)
lim_esc_counts = [sum(yearly_esc_ccpr_counts[y][c] for c in esc_categories) for y in yrs_lim]
lim_ccpr_counts = [sum(yearly_esc_ccpr_counts[y][c] for c in ccpr_categories) for y in yrs_lim]
tot_lim = [e + c for e, c in zip(lim_esc_counts, lim_ccpr_counts)]
lim_esc_pct = [100 * e / t if t else 0 for e, t in zip(lim_esc_counts, tot_lim)]
lim_ccpr_pct = [100 * c / t if t else 0 for c, t in zip(lim_ccpr_counts, tot_lim)]

fig, ax = plt.subplots(figsize=(14, 7))
bar1 = ax.bar(yrs_lim, lim_esc_counts, color="red", label="ESC Rights", alpha=0.9)
bar2 = ax.bar(yrs_lim, lim_ccpr_counts, bottom=lim_esc_counts, color="blue", label="CCPR Rights", alpha=0.9)

for i, (b1, b2) in enumerate(zip(bar1, bar2)):
    y_ = yrs_lim[i]
    if tot_lim[i] > 0:
        if y_ in [2009, 2010, 2011]:
            ax.text(
                b2.get_x() + b2.get_width()/2, b2.get_y() + b2.get_height()/2,
                f"{lim_ccpr_pct[i]:.1f}%", ha="center", va="center", fontsize=9, color="white"
            )
        else:
            ax.text(
                b1.get_x() + b1.get_width()/2, b1.get_height()/2,
                f"{lim_esc_pct[i]:.1f}%", ha="center", va="center", fontsize=9, color="white"
            )
            ax.text(
                b2.get_x() + b2.get_width()/2, b2.get_y() + b2.get_height()/2,
                f"{lim_ccpr_pct[i]:.1f}%", ha="center", va="center", fontsize=9, color="white"
            )

ax.set_title("Stacked Bar Chart of ESC vs CCPR Rights Mentions (2009–2024)")
ax.set_xlabel("Year")
ax.set_ylabel("Number of Mentions")
ax.set_xticks(yrs_lim)
ax.set_xticklabels(yrs_lim, rotation=45)
ax.legend(loc="upper left")

plt.tight_layout()
plt.show()
