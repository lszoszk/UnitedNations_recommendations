import pandas as pd
import json
from dateutil.parser import parse

# --- Configuration ---
INPUT_FILE = 'Data/UHRI_2006_2024.xlsx'   # Path to input Excel file
OUTPUT_FILE = 'Data/UHRI_Internet.json'   # Path to output JSON file
KEYWORDS = ['internet', 'online', 'digital']

def contains_keywords(text, keywords):
    """Return True if 'text' contains any of the 'keywords' (case-insensitive)."""
    return any(k in text.lower() for k in keywords) if isinstance(text, str) else False

def is_empty_record(item):
    """Return True if all values in 'item' are None, empty string, or empty list."""
    return all(v in [None, "", []] for v in item.values())

def process_record(item):
    """
    Append '; - Special Procedures' to 'Reccomending Body' if it starts with
    '- IE', '- WG', or '- SR', and extract year from 'Document Publication Date'.
    """
    body = item.get('Reccomending Body', '')
    if isinstance(body, str) and any(body.startswith(prefix) for prefix in ['- IE', '- WG', '- SR']):
        if '- Special Procedures' not in body:
            item['Reccomending Body'] = body + '; - Special Procedures'

    pub_date = item.get('Document Publication Date', '')
    try:
        if isinstance(pub_date, pd.Timestamp):
            pub_date = pub_date.strftime('%Y-%m-%d')
        if isinstance(pub_date, str) and pub_date.strip():
            item['Year'] = parse(pub_date).year
        else:
            item['Year'] = None
    except Exception:
        item['Year'] = None

    # Convert publication date to string or None for JSON compatibility
    item['Document Publication Date'] = pub_date if pub_date else None
    return item

def main():
    try:
        df = pd.read_excel(INPUT_FILE)
    except FileNotFoundError:
        print(f"Error: The file '{INPUT_FILE}' was not found.")
        return
    except Exception as e:
        print(f"Error: Could not load the Excel file. {e}")
        return

    # Convert to list of dicts and filter by keywords
    data = df.to_dict(orient='records')
    filtered_data = [i for i in data if contains_keywords(i.get('Text', ''), KEYWORDS)]

    # Process, remove empty records, and count changes
    processed_data = [process_record(i) for i in filtered_data]
    final_data = [i for i in processed_data if not is_empty_record(i)]
    removed_count = len(processed_data) - len(final_data)

    total_records = len(final_data)
    records_with_year = sum(1 for i in final_data if i.get('Year') is not None)

    print(f"Total records after filtering: {total_records}")
    print(f"Records with assigned year: {records_with_year}")
    print(f"Empty records removed: {removed_count}")

    # Convert any remaining non-serializable types to strings
    serializable_data = json.loads(json.dumps(final_data, default=str))

    try:
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(serializable_data, f, indent=4)
        print(f"Data saved to '{OUTPUT_FILE}'.")
    except Exception as e:
        print(f"Error: Could not save to '{OUTPUT_FILE}'. {e}")

if __name__ == "__main__":
    main()
