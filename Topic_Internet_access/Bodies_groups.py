import string
import random
import seaborn as sns
import matplotlib.pyplot as plt
import matplotlib.cm as cm
from nltk.util import bigrams
from collections import Counter
from nltk.corpus import stopwords
import nltk
import pandas as pd
from nltk.tokenize import word_tokenize
import json

# Load JSON data
with open('../Data/UHRI_Internet.json', 'r', encoding='utf-8') as f:
    data_records = json.load(f)

# Minimal processing: normalize "Reccomending Body" for special procedures
def process_record(item):
    comm = item.get('Reccomending Body', '')
    if any(comm.startswith(pref) for pref in ['- IE', '- WG', '- SR']):
        item['Reccomending Body'] = '- Special Procedures'
    return item

data_records = [process_record(r) for r in data_records]

# Filter out UPR
data_records_small = [r for r in data_records if r.get("Reccomending Body", "") != "- UPR"]

# ----------------------------------------------------------------------
# Count frequency of concerned groups per year
# ----------------------------------------------------------------------
related_words = [
    ("child","children","adolescent","adolescents","juvenile","juveniles"),
    ("migrant","migrants","migrating","asylum","refugee","refugees","stateless"),
    ("women","woman","girl","girls","female"),
    ("disabilities","disability"),
    ("indigenous","minority","minorities","ethnic","racial"),
    ("remote","rural","poor"),
    ("older","elderly")
]

yearly_word_counts = {y: Counter() for y in range(2006, 2025)}
for r in data_records:
    y = r.get("Year")
    txt = r.get("Text","").lower()
    if y and txt:
        toks = word_tokenize(txt)
        for grp in related_words:
            yearly_word_counts[y][grp] += sum(toks.count(word) for word in grp)

years_2006_2024 = range(2006, 2025)
plot_data = {grp: [yearly_word_counts[yr][grp] for yr in years_2006_2024] for grp in related_words}

short_labels = {
    ("child","children","adolescent","adolescents","juvenile","juveniles"): "Children",
    ("migrant","migrants","migrating","asylum","refugee","refugees","stateless"): "Migrants/Refugees",
    ("women","woman","girl","girls","female"): "Women/Girls",
    ("disabilities","disability"): "Persons w/ Disabilities",
    ("indigenous","minority","minorities","ethnic","racial"): "Minorities/Indigenous",
    ("remote","rural","poor"): "Rural/Poor",
    ("older","elderly"): "Older/Elderly"
}

# Broken-axis plot setup
fig, (ax1, ax2) = plt.subplots(2, 1, sharex=True, figsize=(15, 8))
break_point = 200
upper_limit = max((max(val) for val in plot_data.values()), default=0)

# First (upper) subplot
for grp, counts in plot_data.items():
    ax1.plot(years_2006_2024, counts, marker='o', linestyle='', label=short_labels[grp])
ax1.set_ylim(break_point, upper_limit + 200)
ax1.spines['bottom'].set_visible(False)
ax1.xaxis.tick_top()
ax1.tick_params(labeltop=False)
ax1.yaxis.tick_right()

# Second (lower) subplot
for grp, counts in plot_data.items():
    ax2.plot(years_2006_2024, counts, marker='o', linestyle='', label=short_labels[grp])
ax2.set_ylim(0, break_point)
ax2.spines['top'].set_visible(False)
ax2.xaxis.tick_bottom()
ax2.yaxis.tick_right()

# Diagonal breaks
d = .015
kwargs = dict(transform=ax1.transAxes, color='k', clip_on=False)
ax1.plot((-d,+d), (-d,+d), **kwargs)
ax1.plot((1-d,1+d), (-d,+d), **kwargs)
kwargs.update(transform=ax2.transAxes)
ax2.plot((-d,+d),(1-d,1+d),**kwargs)
ax2.plot((1-d,1+d),(1-d,1+d),**kwargs)

# Customize x-axis (tick every 2 years)
xticks_ = list(range(2006, 2025, 2))
ax1.set_xticks(xticks_)
ax2.set_xticks(xticks_)
ax1.set_xticklabels(xticks_)
ax2.set_xticklabels(xticks_)

ax1.legend(loc='upper left', bbox_to_anchor=(0,1))
fig.suptitle('Frequency of Concerned Groups Mentions (2006–2024)', fontsize=16)
plt.xlabel('Year')
plt.ylabel('Number of mentions')
plt.show()

# ----------------------------------------------------------------------
# Count documents by body/year (2007–2024)
# ----------------------------------------------------------------------
years_2007_2024 = range(2007, 2025)
bodies_small = [d.get("Reccomending Body", "Unknown") for d in data_records_small]
unique_bodies = set(bodies_small)
doc_counts_by_body = {body: [0]*len(years_2007_2024) for body in unique_bodies}

for r in data_records_small:
    y = r.get("Year")
    b = r.get("Reccomending Body","Unknown")
    if y in years_2007_2024:
        doc_counts_by_body[b][y - 2007] += 1

# Calculate total docs each year
yearly_counts = [sum(vals) for vals in zip(*doc_counts_by_body.values())]

# ----------------------------------------------------------------------
# Scatterplot: each recommending body vs. total
# ----------------------------------------------------------------------

fig, ax1 = plt.subplots(figsize=(10, 6))
ax2 = ax1.twinx()

# 1) Gather all points we'll plot (count >= 10)
all_points = []
for body, counts in doc_counts_by_body.items():
    if body != "UPR":
        for i, c in enumerate(counts):
            if c >= 10:
                x_val = years_2007_2024[i]
                all_points.append((body, x_val, c))

# 2) Create a colormap with as many distinct colors as there are points
cmap = cm.get_cmap("nipy_spectral", len(all_points))

# 3) For the legend, we'll track the first time each body is plotted
legend_assigned = set()

for idx, (body, x_val, count_val) in enumerate(all_points):
    # Small y-jitter
    y_jitter = count_val + random.uniform(-0.5, 0.5)
    # Label for legend only once per body
    label_ = body if body not in legend_assigned else None
    if label_:
        legend_assigned.add(body)
    # Plot each point with a unique color from the colormap
    ax1.scatter(
        x_val,
        y_jitter,
        color=cmap(idx),  # each point gets a different color
        marker="o",
        alpha=0.7,
        label=label_
    )

# 4) Secondary axis: total counts
ax2.plot(years_2007_2024, yearly_counts, color="black", linewidth=2, label="Total Recs")
ax2.tick_params(axis="y", labelcolor="black")
ax2.set_ylabel("Total number of Internet-related Recommendations (excl. UPR)", fontsize=11)

# 5) Configure axes
ax1.set_xlim(2006, 2025)
x_ticks = range(2006, 2026, 2)
ax1.set_xticks(x_ticks)
ax1.set_xticklabels(x_ticks, fontsize=10)
ax1.set_xlabel("Year", fontsize=12)
ax1.set_ylabel("Counts (>= 10)", fontsize=11)
ax1.set_title("The Most Active UN Mechanisms in Adopting Internet-related Recommendations  (2007–2024)", fontsize=14)

# 6) Combine legend handles from both axes
handles1, labels1 = ax1.get_legend_handles_labels()
handles2, labels2 = ax2.get_legend_handles_labels()
# Only keep unique legend entries (in case of duplicates)
combined = dict(zip(labels1, handles1))
combined.update(dict(zip(labels2, handles2)))
ax1.legend(combined.values(), combined.keys(), loc="upper left", fontsize=9)

plt.tight_layout()
plt.show()

# ----------------------------------------------------------------------
# Bigram Analysis by Concerned Group
# ----------------------------------------------------------------------
target_keywords = ["internet","digital","online"]
custom_stop = ['including','exclusively']
stop_words = set(stopwords.words('english'))
stop_words.update(custom_stop)

def clean_and_tokenize(text):
    return [t for t in nltk.word_tokenize(text.lower())
            if t not in stop_words and t not in string.punctuation]

group_target_bigrams = {g: Counter() for g in related_words}
for r in data_records_small:
    txt = r.get("Text","")
    if not txt: continue
    toks = clean_and_tokenize(txt)
    bgs = list(bigrams(toks))
    for grp in related_words:
        if any(w in txt.lower() for w in grp):
            for bg in bgs:
                if any(k in bg for k in target_keywords):
                    group_target_bigrams[grp][bg] += 1

for grp, ctr in group_target_bigrams.items():
    print(f"Group '{'/'.join(grp)}': {ctr.most_common(10)}")

# ----------------------------------------------------------------------
# Color-coded Grid Plots of Bigrams by (Group, Committee)
# ----------------------------------------------------------------------
grp_map = {
    ("child","children","adolescent","adolescents","juvenile","juveniles"): "Children",
    ("migrant","migrants","migrating","asylum","refugee","refugees","stateless"): "Migrants & Refugees",
    ("women","woman","girl","girls","female"): "Women/Girls",
    ("disabilities","disability"): "Persons with Disabilities",
    ("indigenous","minority","minorities","ethnic","racial"): "Minorities & Indigenous",
    ("remote","rural","poor"): "Remote/Poor",
    ("older","elderly"): "Older Persons"
}

def determine_group(text):
    t = text.lower()
    for words_, gname in grp_map.items():
        if any(w in t for w in words_):
            return gname
    return "Other"

def relevant_bigrams(txt):
    wds = [w for w in word_tokenize(txt.lower()) if w.isalpha() and w not in stop_words]
    bg = list(bigrams(wds))
    return [b for b in bg if any(k in b for k in target_keywords)]

group_committee_bigrams = {}
for r in data_records_small:
    t = r.get('Text','')
    c = r.get('Reccomending Body','Unknown Committee')
    if c.startswith(('- IE','- SR','- WG')):
        c = 'Special Procedures'
    g = determine_group(t)
    if t:
        bgs = relevant_bigrams(t)
        group_committee_bigrams.setdefault((g,c), Counter()).update(bgs)

top_bigrams_gc = {gc: ctr.most_common(10) for gc, ctr in group_committee_bigrams.items()}
df_list = []
for (g,c), bgctr in top_bigrams_gc.items():
    for bg, cnt in bgctr:
        df_list.append({'Group': g, 'Committee': c, 'Bigram': ' '.join(bg), 'Count': cnt})
df = pd.DataFrame(df_list)

def plot_bigrams_by_group(df, grp_map, top_n=7):
    if df.empty:
        print("No data available for plotting.")
        return

    groups = df["Group"].unique()
    num_g = len(groups)
    cols = 2
    rows = (num_g + 1)//cols
    sns.set_theme(style="whitegrid")
    cpal = sns.color_palette("husl", num_g)
    grp_colors = {g: cpal[i] for i,g in enumerate(groups)}

    fig, axs = plt.subplots(rows, cols, figsize=(20,6*rows), constrained_layout=True)
    axs = axs.flatten()

    for i,g in enumerate(groups):
        ax = axs[i]
        sub_df = df[df["Group"]==g]
        pivot_ = sub_df.pivot_table(index="Bigram", columns="Group", values="Count", aggfunc="sum", fill_value=0)
        top_ = pivot_.sum(axis=1).sort_values(ascending=False).head(top_n)
        pivot_ = pivot_.loc[top_.index]

        if not pivot_.empty:
            color_ = grp_colors[g]
            ax.barh(pivot_.index, pivot_.values.flatten(), color=color_, edgecolor="black")
            ax.set_title(grp_map.get(g,g), fontsize=14, fontweight="bold")
            ax.invert_yaxis()
            ax.legend([plt.Line2D([0],[0], color=color_, lw=4)], [grp_map.get(g,g)], loc="lower right")
        else:
            ax.text(0.5,0.5,"No Data", ha="center", va="center", fontsize=12, color="gray")
            ax.axis("off")

    for j in range(num_g,len(axs)): axs[j].axis("off")
    plt.suptitle("Top Bigrams by Concerned Group", fontsize=18, fontweight="bold", y=1.02)
    plt.show()

plot_bigrams_by_group(df, grp_map, top_n=7)

# ----------------------------------------------------------------------
#  Plot of Bigrams by Mechanism
# ----------------------------------------------------------------------
treaty_bodies = ["- CCPR","- CESCR","- CEDAW","- CRC","- CRPD","- CERD","- CRC-OP-AC","- CRC-OP-SC","- Special Procedures","- UPR"]
bigrams_to_ignore = [
    ("state","party"), ("committee","concerned"), ("also","concerned"), ("concluding","observations"),
    ("true","table"), ("committee","recommends"), ("recommends","state"), ("false","true"), ("true","true"),
    ("notes","concern"), ("art","committee"), ("article","convention"), ("concerned","reports"),
    ("committee","also"), ("table","colorful"), ("accent","w"), ("colorful","accent"), ("true","list"),
    ("w","lsdexception"), ("committe","notes"), ("children","including"), ("order","generate"), ("widely","available"),
    ("per","cent"), ("nbsp","nbsp"), ("including","internet"), ("grid","table"), ("expression","including"),
    ("report","written"), ("written","replies"), ("article","covenant"), ("list","table"), ("groups","children"),
    ("list","table"), ("state","submitted")
]

def filter_bigrams(txt):
    wds = [w for w in word_tokenize(txt.lower()) if w.isalpha() and w not in stop_words]
    return [b for b in bigrams(wds) if b not in bigrams_to_ignore]

tb_bigrams = {tb: Counter() for tb in treaty_bodies}
for r in data_records:
    t = r.get("Text","").strip()
    b = r.get("Reccomending Body","").strip()
    if b in treaty_bodies and t:
        tb_bigrams[b].update(filter_bigrams(t))

# Build DataFrame of top bigrams per treaty body
rows = []
for tb, ctr in tb_bigrams.items():
    for bg, cnt in ctr.most_common(10):
        rows.append({"Treaty Body": tb, "Bigram": " ".join(bg), "Count": cnt})
df = pd.DataFrame(rows)

def plot_treaty_body_bigrams(df, top_n=10):
    if df.empty:
        print("No data available for plotting.")
        return

    df["Treaty Body"] = df["Treaty Body"].replace({"- Special Procedures": "Special Procedures"})
    df["Treaty Body"] = df["Treaty Body"].str.replace("^- ","",regex=True)

    unique_bodies = df["Treaty Body"].unique()
    cols, rows = 3, (len(unique_bodies)+2)//3
    sns.set_theme(style="whitegrid")
    palette_ = sns.color_palette("husl", len(unique_bodies))
    body_colors = {b: palette_[i] for i,b in enumerate(unique_bodies)}

    fig, axs = plt.subplots(rows, cols, figsize=(20, 6*rows), constrained_layout=True)
    axs = axs.flatten()

    for i,b in enumerate(unique_bodies):
        ax = axs[i]
        sub_df = df[df["Treaty Body"]==b].nlargest(top_n,"Count")
        if not sub_df.empty:
            ax.barh(sub_df["Bigram"], sub_df["Count"], color=body_colors[b], edgecolor="black")
            ax.set_title(b, fontsize=14, fontweight="bold")
            ax.invert_yaxis()
        else:
            ax.text(0.5,0.5,"No Data", ha="center", va="center", fontsize=12, color="gray")
        ax.grid(axis="x", linestyle="--", alpha=0.7)

    for j in range(len(unique_bodies), len(axs)): axs[j].axis("off")
    handles = [plt.Line2D([0],[0],color=body_colors[b],lw=4) for b in body_colors]
    fig.legend(handles, body_colors.keys(), title="Treaty Body", loc="lower center",
               bbox_to_anchor=(0.5,-0.05), ncol=cols, fancybox=True, shadow=True)
    plt.suptitle("Top Bigrams by Treaty Body", fontsize=18, fontweight="bold", y=1.02)
    plt.show()

plot_treaty_body_bigrams(df, top_n=10)
