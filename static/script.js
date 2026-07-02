// Example: fetch data from your Flask API
async function getData() {
    const response = await fetch("/api/data");
    const data = await response.json();
    console.log(data);
}

getData();