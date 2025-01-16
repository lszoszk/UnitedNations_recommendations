import json
from dateutil.parser import parse
import matplotlib.pyplot as plt

# Load JSON data
with open("../Data/UHRI_Internet.json", "r", encoding="utf-8") as f:
    data = json.load(f)

# Filter for UPR recommendations only
upr_records = [r for r in data if r.get("Reccomending Body","").strip() == "- UPR"]

theme = "- Freedom of opinion and expression & access to information"
yrs = range(2010, 2025)
counts = {y: {"total":0,"theme":0} for y in yrs}

# Tally theme mentions
for r in upr_records:
    pub_date = r.get("Document Publication Date","").strip()
    try: y = parse(pub_date, fuzzy=True).year
    except: continue
    if y in yrs:
        counts[y]["total"] += 1
        if theme in r.get("Themes",""):
            counts[y]["theme"] += 1

# Prepare stacked data
x_vals = list(counts.keys())
theme_vals = [counts[y]["theme"] for y in x_vals]
other_vals = [counts[y]["total"]-counts[y]["theme"] for y in x_vals]
theme_pct = [
    (t / counts[y]["total"]*100) if counts[y]["total"] else 0
    for y, t in zip(x_vals, theme_vals)
]
other_pct = [
    (o / counts[y]["total"]*100) if counts[y]["total"] else 0
    for y, o in zip(x_vals, other_vals)
]

# Plot
fig, ax = plt.subplots(figsize=(12, 6))
bar1 = ax.bar(x_vals, theme_vals, color="darkblue", label="Freedom of expression")
bar2 = ax.bar(x_vals, other_vals, bottom=theme_vals, color="lightblue", label="Other human rights")

for i,(t,o) in enumerate(zip(theme_vals, other_vals)):
    y_ = x_vals[i]
    if y_ == 2011:
        ax.text(y_, t + o/2, f"{other_pct[i]:.1f}%", ha="center", fontsize=10, color="black")
    else:
        if t>0: ax.text(y_, t/2, f"{theme_pct[i]:.1f}%", ha="center", fontsize=10, color="white")
        if o>0: ax.text(y_, t + o/2, f"{other_pct[i]:.1f}%", ha="center", fontsize=10, color="black")

ax.set_xlabel("Year", fontsize=12)
ax.set_ylabel("Number of UPR Recommendations", fontsize=12)
ax.set_title("UPR Recommendations: Freedom of Expression vs Other (2010–2024)", fontsize=14)
ax.legend(loc="upper left", fontsize=10)
ax.grid(axis="y", linestyle="--", alpha=0.7)
plt.tight_layout()
plt.show()
