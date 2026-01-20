#!/usr/bin/env node

/**
 * Token Analytics Viewer
 * 
 * View optimization stats and usage analytics
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(process.env.HOME, '.copilot', 'token-analytics.db');

const db = new sqlite3.Database(DB_PATH);

console.log('\n🔍 Token Optimization Analytics\n');
console.log('='.repeat(60));

// Overall stats
db.get(`
  SELECT 
    COUNT(*) as total_tools,
    AVG(reduction_percent) as avg_reduction,
    SUM(original_size - optimized_size) as total_bytes_saved
  FROM optimization_results
`, (err, row) => {
  if (err) {
    console.error('Error:', err);
    return;
  }
  
  if (row && row.total_tools > 0) {
    console.log('\n📊 Overall Optimization Stats:');
    console.log(`   Tools optimized: ${row.total_tools}`);
    console.log(`   Average reduction: ${row.avg_reduction.toFixed(1)}%`);
    console.log(`   Total bytes saved: ${row.total_bytes_saved.toLocaleString()}`);
    console.log(`   Estimated tokens saved: ${Math.floor(row.total_bytes_saved / 4).toLocaleString()}`);
  }
});

// Top optimizations
db.all(`
  SELECT 
    tool_name,
    original_size,
    optimized_size,
    reduction_percent
  FROM optimization_results
  ORDER BY (original_size - optimized_size) DESC
  LIMIT 10
`, (err, rows) => {
  if (err) {
    console.error('Error:', err);
    return;
  }
  
  if (rows && rows.length > 0) {
    console.log('\n\n🏆 Top 10 Optimizations (by bytes saved):');
    console.log('-'.repeat(60));
    rows.forEach((row, i) => {
      const saved = row.original_size - row.optimized_size;
      console.log(`${i + 1}. ${row.tool_name}`);
      console.log(`   ${row.original_size} → ${row.optimized_size} bytes (${row.reduction_percent.toFixed(1)}% reduction)`);
      console.log(`   Saved: ${saved} bytes (~${Math.floor(saved / 4)} tokens)`);
    });
  }
});

// Tool usage stats
db.all(`
  SELECT 
    tool_name,
    COUNT(*) as call_count,
    AVG(execution_time_ms) as avg_time,
    SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures
  FROM tool_usage
  GROUP BY tool_name
  ORDER BY call_count DESC
  LIMIT 10
`, (err, rows) => {
  if (err) {
    console.error('Error:', err);
    return;
  }
  
  if (rows && rows.length > 0) {
    console.log('\n\n📈 Top 10 Most Used Tools:');
    console.log('-'.repeat(60));
    rows.forEach((row, i) => {
      console.log(`${i + 1}. ${row.tool_name}`);
      console.log(`   Calls: ${row.call_count} | Avg time: ${Math.floor(row.avg_time)}ms | Failures: ${row.failures}`);
    });
  }
});

// Session stats
db.all(`
  SELECT 
    datetime(timestamp/1000, 'unixepoch') as session_time,
    session_duration_ms,
    total_tool_calls,
    tokens_saved
  FROM session_metrics
  ORDER BY timestamp DESC
  LIMIT 5
`, (err, rows) => {
  if (err) {
    console.error('Error:', err);
    db.close();
    return;
  }
  
  if (rows && rows.length > 0) {
    console.log('\n\n📅 Recent Sessions:');
    console.log('-'.repeat(60));
    rows.forEach((row, i) => {
      const duration = Math.floor(row.session_duration_ms / 1000);
      console.log(`${i + 1}. ${row.session_time}`);
      console.log(`   Duration: ${duration}s | Tool calls: ${row.total_tool_calls} | Tokens saved: ${row.tokens_saved}`);
    });
  }

  console.log('\n' + '='.repeat(60) + '\n');
  db.close();
});
