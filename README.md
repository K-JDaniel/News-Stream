# 📰 News Stream

A responsive news aggregation web application built using HTML, CSS, and Vanilla JavaScript.

News Stream retrieves news articles from the GNews API and provides a simple interface for browsing articles by category, searching for specific topics, and opening the original articles.

## Features

- Fetches news articles from the GNews API
- Category-based news browsing
- Client-side search across article titles, descriptions, and sources
- Dynamic rendering of news article cards
- Category-based in-memory caching to reduce repeated API requests
- Search without additional API requests
- Loading, error, and empty-result states
- Responsive design for desktop, tablet, and mobile screens
- Preserves selected category and search query using `sessionStorage`
- Opens original articles in a new browser tab
- Handles missing article images with a fallback image
- Handles network, HTTP, JSON parsing, and unexpected API response errors

## Technologies Used

- HTML5
- CSS3
- Vanilla JavaScript
- REST API
- Fetch API
- GNews API
- sessionStorage

## How It Works

1. The application loads the initial news category from the GNews API.
2. JavaScript processes the API response and stores the articles in an in-memory category cache.
3. Users can switch between available news categories.
4. A category is fetched only when it has not already been loaded during the current browser session.
5. Users can search through the currently available articles without making another API request.
6. JavaScript dynamically generates and updates the news article cards in the DOM.
7. Users can open the original article through the "Read more" link.

## Project Structure

```text
News-Stream/
├── index.html
├── style.css
├── script.js
└── README.md