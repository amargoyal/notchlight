-- Write the current Apple Music track's artwork to a file.
--   osascript music-artwork.applescript /path/to/output
-- Prints the raw format name (JPEG or PNG) on success, or "none". JavaScript for
-- Automation cannot hand raw picture data to a file cleanly; AppleScript can.
on run argv
  if (count of argv) < 1 then return "none"
  set outputPath to item 1 of argv
  try
    tell application "Music"
      if not (exists current track) then return "none"
      if (count of artworks of current track) is 0 then return "none"
      set art to artwork 1 of current track
      set picture to raw data of art
      set kind to format of art as text
    end tell
  on error
    return "none"
  end try
  set handle to open for access (POSIX file outputPath) with write permission
  try
    set eof handle to 0
    write picture to handle
    close access handle
  on error message
    close access handle
    error message
  end try
  return kind
end run
