import json
import pandas as pd

# --- Configuration ---
INPUT_FILE = "../Data/UHRI_Internet.json"  # Path to the input JSON file
OUTPUT_EXCEL_FILE = "Internet_Distribution.xlsx"  # Output Excel file

TARGET_WORDS = [
    "internet access", "digital divide", "connectivity",
    "access online", "access digital"
]

# The 13 (or 14) selected recommending bodies.
SELECTED_BODIES = [
    "- CAT", "- CCPR", "- CEDAW", "- CERD", "- CESCR", "- CMW",
    "- CRC", "- CRC-OP-AC", "- CRC-OP-SC", "- CRPD", "- CED", "- SPT", "- UPR",
    "- Special Procedures"
]


def standardize_body(record):
    """
    Standardizes the 'Reccomending Body' field.
    If the field contains "- Special Procedures", it is re‐labeled as "- Special Procedures".
    """
    body = record.get("Reccomending Body", "")
    if isinstance(body, str) and "- Special Procedures" in body:
        record["Reccomending Body"] = "- Special Procedures"
    return record


def add_dummy_variable(record):
    """
    Returns 1 if the record's 'Text' field contains any of the TARGET_WORDS (case-insensitive),
    otherwise returns 0.
    """
    txt = record.get("Text", "").lower()
    return int(any(word in txt for word in TARGET_WORDS))


def generate_body_distribution_table(data, start_yr=2006, end_yr=2024):
    """
    Generates a pivot table with rows as the selected recommending bodies and columns
    as years (from start_yr to end_yr). A 'TOTAL' column (row sums) and a 'TOTAL' row (column sums)
    are appended.
    """
    df = pd.DataFrame(data)
    # Filter records to valid years
    df = df[df["Year"].between(start_yr, end_yr)]
    # Filter to only include the selected recommending bodies
    df = df[df["Reccomending Body"].isin(SELECTED_BODIES)]

    # Create pivot table: rows=Reccomending Body, columns=Year
    pivot = pd.crosstab(df["Reccomending Body"], df["Year"])

    # Ensure all years from start_yr to end_yr exist as columns
    all_years = list(range(start_yr, end_yr + 1))
    pivot = pivot.reindex(columns=all_years, fill_value=0)

    # Add a 'TOTAL' column (row sum)
    pivot["TOTAL"] = pivot.sum(axis=1)

    # Append a 'TOTAL' row (column sums)
    total_row = pivot.sum(axis=0)
    pivot = pd.concat([pivot, total_row.to_frame().T.rename(index={0: "TOTAL"})])

    return pivot


def generate_internet_share_table(data, start_yr=2006, end_yr=2024):
    """
    For each year, calculates:
      - Total number of recommendations (all bodies)
      - Number of internet-related recommendations (based on TARGET_WORDS)
      - Share (%) of internet-related recommendations
    A TOTAL row (summing counts and recalculating the overall share) is appended.
    """
    df = pd.DataFrame(data)
    # Filter records to valid years
    df = df[df["Year"].between(start_yr, end_yr)]

    # Total recommendations per year
    total_by_year = df.groupby("Year").size()

    # Compute internet-related dummy variable per record
    df["Internet"] = df.apply(lambda r: add_dummy_variable(r), axis=1)
    internet_by_year = df.groupby("Year")["Internet"].sum()

    years = list(range(start_yr, end_yr + 1))
    share_df = pd.DataFrame({
        "Total": total_by_year.reindex(years, fill_value=0),
        "Internet": internet_by_year.reindex(years, fill_value=0)
    })
    share_df["Share (%)"] = (share_df["Internet"] / share_df["Total"] * 100).round(1)
    share_df["Share (%)"] = share_df["Share (%)"].fillna(0)
    share_df.index.name = "Year"

    # Append a TOTAL row (summing counts)
    total_sum = share_df.sum(numeric_only=True)
    if total_sum["Total"] > 0:
        total_sum["Share (%)"] = round((total_sum["Internet"] / total_sum["Total"] * 100), 1)
    else:
        total_sum["Share (%)"] = 0
    total_sum.name = "TOTAL"
    share_df = pd.concat([share_df, total_sum.to_frame().T])

    return share_df


def get_missing_recommendations(data, start_yr=2006, end_yr=2024):
    """
    Identifies the recommendation(s) in the full dataset that were not counted in the
    distribution table. These are records that either fall outside the year range or
    have a 'Reccomending Body' not in the SELECTED_BODIES.
    """
    df_full = pd.DataFrame(data)
    # Apply the same year filter as used in the tables
    df_year = df_full[df_full["Year"].between(start_yr, end_yr)]
    # Filter the dataset based on the selected recommending bodies
    df_included = df_year[df_year["Reccomending Body"].isin(SELECTED_BODIES)]

    # Identify the records in df_year that are not in df_included
    missing = df_year.loc[~df_year.index.isin(df_included.index)]
    return missing


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

    # Standardize the recommending body for all records
    data = [standardize_body(r) for r in data]

    # Generate the two tables
    distribution_table = generate_body_distribution_table(data, 2006, 2024)
    internet_share_table = generate_internet_share_table(data, 2006, 2024)

    # Identify missing recommendation(s)
    missing_recs = get_missing_recommendations(data, 2006, 2024)
    if len(missing_recs) == 1:
        print("The recommendation that is in the full dataset but not in the table is:")
        print(missing_recs)
    elif len(missing_recs) > 1:
        print(f"There are {len(missing_recs)} recommendations not included in the table:")
        print(missing_recs)
    else:
        print("No missing recommendations found.")

    # Export the tables to an Excel file with two sheets
    with pd.ExcelWriter(OUTPUT_EXCEL_FILE, engine="openpyxl") as writer:
        distribution_table.to_excel(writer, sheet_name="Body Distribution")
        internet_share_table.to_excel(writer, sheet_name="Internet Share")
    print(f"Tables saved to '{OUTPUT_EXCEL_FILE}'.")


if __name__ == "__main__":
    main()
