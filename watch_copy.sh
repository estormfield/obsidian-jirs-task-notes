#!/bin/bash

# Source and destination paths
SOURCE_FILE="main.js"
DESTINATION_PATH="$HOME/Documents/WorkSync/.obsidian/plugins/obsidian-jira-notes"
# Ensure destination directory exists
mkdir -p "$DESTINATION_PATH"

# Watch the current directory for changes to main.ts
fswatch -o "$SOURCE_FILE" | while read -r event
do
    if [ -f "$SOURCE_FILE" ]; then
        cp "$SOURCE_FILE" "$DESTINATION_PATH"
        echo "main.ts has been copied to $DESTINATION_PATH"
    else
        echo "main.ts does not exist."
    fi
done