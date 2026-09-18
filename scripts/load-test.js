import http from 'k6/http';
import { check, sleep } from 'k6';

// Load Testing against our API to verify if Supabase connection pool is the bottleneck
export const options = {
  stages: [
    { duration: '10s', target: 50 },  // ramp up to 50 users
    { duration: '30s', target: 50 },  // stay at 50 users
    { duration: '10s', target: 0 },   // ramp down
  ],
};

export default function () {
  // Replace with actual API endpoints if authentication headers are injected
  // This simulates heavy concurrent requests that hit the database.
  const res = http.get('http://localhost:3002/api/v1/health'); 
  
  check(res, {
    'is status 200': (r) => r.status === 200,
    'transaction time OK': (r) => r.timings.duration < 200,
  });
  
  sleep(1);
}
