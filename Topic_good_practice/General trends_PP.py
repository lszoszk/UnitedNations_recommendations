import json
import matplotlib.pyplot as plt
from collections import Counter

# Configuration
INPUT_FILE = "../UHRI_2006_2024_goodpr.json"
FILTER_OUT_UPR = False  # Set to False to include UPR recommendations

PRACTICE_TYPES = {
    'promising_practice': 'promising practice',
    'good_practice': 'good practice',
    'best_practice': 'best practice'
}


def should_include_record(record):
    """Check if record should be included based on filtering options."""
    if FILTER_OUT_UPR:
        recommending_body = record.get("Reccomending Body", "").strip()
        if recommending_body == "- UPR":
            return False
    return True


def categorize_practice(record):
    """Return which type of practice this record contains, or None if none."""
    txt = record.get("Text", "").lower()

    # Check each practice type (order matters - best practice is most specific)
    if 'best practice' in txt:
        return 'best_practice'
    elif 'good practice' in txt:
        return 'good_practice'
    elif 'promising practice' in txt:
        return 'promising_practice'
    else:
        return None


def count_practice_frequencies(data, start_yr=2006, end_yr=2024):
    """Count frequencies of each practice type by year."""
    practice_counts = {practice: Counter() for practice in PRACTICE_TYPES.keys()}
    total_counts = Counter()

    for record in data:
        # Apply filtering
        if not should_include_record(record):
            continue

        year = record.get("Year")
        if isinstance(year, int) and start_yr <= year <= end_yr:
            total_counts[year] += 1
            practice_type = categorize_practice(record)
            if practice_type:
                practice_counts[practice_type][year] += 1

    return practice_counts, total_counts


def plot_stacked_practice_bars(practice_counts, start_yr=2006, end_yr=2024):
    """Plot stacked bar chart showing different practice types by year with percentage labels."""
    years = list(range(start_yr, end_yr + 1))

    # Get counts for each practice type
    promising = [practice_counts['promising_practice'].get(y, 0) for y in years]
    good = [practice_counts['good_practice'].get(y, 0) for y in years]
    best = [practice_counts['best_practice'].get(y, 0) for y in years]

    plt.figure(figsize=(14, 8))

    # Create stacked bars (heights still show absolute numbers)
    bar1 = plt.bar(years, promising, color="#ff9999", label="Promising Practice")
    bar2 = plt.bar(years, good, bottom=promising, color="#66b3ff", label="Good Practice")

    # Calculate bottom for best practice bars
    bottom_best = [p + g for p, g in zip(promising, good)]
    bar3 = plt.bar(years, best, bottom=bottom_best, color="#99ff99", label="Best Practice")

    # Add percentage labels on bars
    for i, year in enumerate(years):
        total = promising[i] + good[i] + best[i]
        if total > 0:
            # Calculate percentages
            promising_pct = (promising[i] / total) * 100
            good_pct = (good[i] / total) * 100
            best_pct = (best[i] / total) * 100

            # Label for promising practice (show percentage if segment is large enough OR for last two years)
            if promising_pct > 8 or year in [2023, 2024]:  # Always show for 2023 and 2024
                if promising[i] > 0:  # Only show if there are any promising practice recommendations
                    plt.text(year, promising[i] / 2, f"{promising_pct:.1f}%",
                             ha="center", va="center", fontsize=8, fontweight='bold')

            # Label for good practice
            if good_pct > 8:
                plt.text(year, promising[i] + good[i] / 2, f"{good_pct:.1f}%",
                         ha="center", va="center", fontsize=8, fontweight='bold')

            # Label for best practice
            if best_pct > 8:
                plt.text(year, promising[i] + good[i] + best[i] / 2, f"{best_pct:.1f}%",
                         ha="center", va="center", fontsize=8, fontweight='bold')

    filter_note = " (UPR filtered out)" if FILTER_OUT_UPR else " (including UPR)"
    plt.title(f"Distribution of Practice Types in UHRI Recommendations (2006–2024){filter_note}", fontsize=14, pad=20)
    plt.xlabel("Year", fontsize=12)
    plt.ylabel("Number of Recommendations", fontsize=12)
    plt.xticks(years, rotation=45)
    plt.legend(loc='upper left')
    plt.grid(axis='y', alpha=0.3)
    plt.tight_layout()
    plt.show()


def plot_total_practice_trends(practice_counts, start_yr=2006, end_yr=2024):
    """Plot line chart showing trends for each practice type."""
    years = list(range(start_yr, end_yr + 1))

    promising = [practice_counts['promising_practice'].get(y, 0) for y in years]
    good = [practice_counts['good_practice'].get(y, 0) for y in years]
    best = [practice_counts['best_practice'].get(y, 0) for y in years]

    plt.figure(figsize=(12, 7))

    plt.plot(years, promising, marker="o", linewidth=2, label="Promising Practice", color="#ff6666")
    plt.plot(years, good, marker="s", linewidth=2, label="Good Practice", color="#3399ff")
    plt.plot(years, best, marker="^", linewidth=2, label="Best Practice", color="#66cc66")

    filter_note = " (UPR filtered out)" if FILTER_OUT_UPR else " (including UPR)"
    plt.title(f"Trends in Practice Types Over Time (2006–2024){filter_note}", fontsize=14)
    plt.xlabel("Year", fontsize=12)
    plt.ylabel("Number of Recommendations", fontsize=12)
    plt.xticks(range(start_yr, end_yr + 1, 2))
    plt.legend()
    plt.grid(alpha=0.3)
    plt.tight_layout()
    plt.show()


def print_summary_stats(practice_counts, total_counts):
    """Print summary statistics."""
    total_promising = sum(practice_counts['promising_practice'].values())
    total_good = sum(practice_counts['good_practice'].values())
    total_best = sum(practice_counts['best_practice'].values())
    grand_total = sum(total_counts.values())

    filter_note = " (UPR filtered out)" if FILTER_OUT_UPR else " (including UPR)"
    print(f"\nSummary Statistics{filter_note}:")
    print(f"Total records analyzed: {grand_total}")
    print(f"Promising Practice recommendations: {total_promising}")
    print(f"Good Practice recommendations: {total_good}")
    print(f"Best Practice recommendations: {total_best}")
    print(f"Total practice recommendations: {total_promising + total_good + total_best}")


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

    practice_counts, total_counts = count_practice_frequencies(data, 2006, 2024)

    print_summary_stats(practice_counts, total_counts)
    plot_stacked_practice_bars(practice_counts, 2006, 2024)
    plot_total_practice_trends(practice_counts, 2006, 2024)


if __name__ == "__main__":
    main()