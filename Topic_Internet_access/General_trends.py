import json
import matplotlib.pyplot as plt
from collections import Counter

# Configuration
INPUT_FILE = "../Data/UHRI_Internet.json"
TARGET_WORDS = [
    "internet access", "digital divide", "connectivity",
    "access online", "access digital"
]


def add_dummy_variable(record):
    txt = record.get("Text", "").lower()
    return int(any(word in txt for word in TARGET_WORDS))


def count_frequencies(data, start_yr=2006, end_yr=2024):
    tgt_counts, tot_counts = Counter(), Counter()
    for r in data:
        y = r.get("Year")
        if isinstance(y, int) and start_yr <= y <= end_yr:
            tot_counts[y] += 1
            if add_dummy_variable(r):
                tgt_counts[y] += 1
    return tgt_counts, tot_counts


def plot_stacked_bar(tgt_counts, tot_counts, start_yr=2010, end_yr=2024):
    yrs = list(range(start_yr, end_yr + 1))
    tgt = [tgt_counts.get(y, 0) for y in yrs]
    non_tgt = [tot_counts.get(y, 0) - tc for y, tc in zip(yrs, tgt)]

    plt.figure(figsize=(12, 7))
    b1 = plt.bar(yrs, non_tgt, color="lightgray", label="Other recommendations")
    b2 = plt.bar(yrs, tgt, bottom=non_tgt, color="skyblue", label="Recs related to Internet access")

    for x, top1, top2, nt, t in zip(yrs, b1, b2, non_tgt, tgt):
        total = nt + t
        if total > 0:
            pct = (t / total) * 100
            plt.text(x, top1.get_height() + top2.get_height() / 2,
                     f"{pct:.1f}%", ha="center", va="center", fontsize=9)

    plt.title("Recommendations specifically on Internet access among recommendations related to the digital environment (2006–2024)")
    plt.xlabel("Year")
    plt.ylabel("Number of Recommendations")
    plt.xticks(yrs, rotation=45)
    plt.legend()
    plt.tight_layout()
    plt.show()


def plot_total_recs(tot_counts, start_yr=2006, end_yr=2024):
    yrs = list(range(start_yr, end_yr + 1))
    vals = [tot_counts.get(y, 0) for y in yrs]

    plt.figure(figsize=(10, 6))
    plt.plot(yrs, vals, marker="o")
    plt.xticks(range(start_yr, end_yr + 1, 2))
    plt.xlabel("Year")
    plt.ylabel("Total Recommendations")
    plt.title("Total Recommendations (2006–2024)")
    plt.tight_layout()
    plt.show()


def main():
    try:
        with open(INPUT_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"File not found: {INPUT_FILE}")
        return
    except json.JSONDecodeError:
        print("JSON decode error.")
        return

    tgt_counts, tot_counts = count_frequencies(data, 2006, 2024)
    plot_stacked_bar(tgt_counts, tot_counts, 2006, 2024)
    plot_total_recs(tot_counts, 2006, 2024)


if __name__ == "__main__":
    main()
