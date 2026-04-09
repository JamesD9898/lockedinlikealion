# locked in like a lion

study tool for AP Physics C and beyond.

## setup

```bash
# need mongodb running locally
npm install
npm start        # http://localhost:3000
npm run dev      # with auto-reload
```

## adding content

1. create a course from the dashboard
2. go to the course → "upload json"
3. paste json (see `sample-content.json` for format)

## json format

```json
{
  "units": [
    {
      "title": "Unit Name",
      "order": 1,
      "overview": "Summary text...",
      "problemSets": [
        {
          "title": "Problem Set Title",
          "type": "problem_set",   // or "exam"
          "timeLimit": 25,          // minutes (optional)
          "order": 1,
          "questions": [
            {
              "number": 1,
              "text": "Question prompt...",
              "points": 15,
              "parts": [
                {
                  "label": "(a)",
                  "text": "Part prompt...",
                  "points": 5,
                  "answer": "Solution..."
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```
