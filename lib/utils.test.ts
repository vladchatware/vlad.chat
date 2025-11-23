import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { getRelativeTime } from './utils';

describe('getRelativeTime', () => {
    beforeEach(() => {
        // Set a fixed "now" time: 2024-01-01T12:00:00Z
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should return seconds ago', () => {
        const date = new Date('2024-01-01T11:59:50Z'); // 10 seconds ago
        expect(getRelativeTime(date)).toBe('10 seconds ago');
    });

    it('should return minutes ago', () => {
        const date = new Date('2024-01-01T11:55:00Z'); // 5 minutes ago
        expect(getRelativeTime(date)).toBe('5 minutes ago');
    });

    it('should return hours ago', () => {
        const date = new Date('2024-01-01T09:00:00Z'); // 3 hours ago
        expect(getRelativeTime(date)).toBe('3 hours ago');
    });

    it('should return days ago', () => {
        const date = new Date('2023-12-25T12:00:00Z'); // 7 days ago
        expect(getRelativeTime(date)).toBe('7 days ago');
    });

    it('should return months ago', () => {
        const date = new Date('2023-11-01T12:00:00Z'); // 2 months ago
        expect(getRelativeTime(date)).toBe('2 months ago');
    });

    it('should return years ago', () => {
        const date = new Date('2022-01-01T12:00:00Z'); // 2 years ago
        expect(getRelativeTime(date)).toBe('2 years ago');
    });

    it('should handle singular units correctly', () => {
        const oneSecondAgo = new Date('2024-01-01T11:59:59Z');
        expect(getRelativeTime(oneSecondAgo)).toBe('1 second ago');

        const oneMinuteAgo = new Date('2024-01-01T11:59:00Z');
        expect(getRelativeTime(oneMinuteAgo)).toBe('1 minute ago');

        const oneHourAgo = new Date('2024-01-01T11:00:00Z');
        expect(getRelativeTime(oneHourAgo)).toBe('1 hour ago');

        const oneDayAgo = new Date('2023-12-31T12:00:00Z');
        expect(getRelativeTime(oneDayAgo)).toBe('yesterday');

        const oneMonthAgo = new Date('2023-12-01T12:00:00Z');
        expect(getRelativeTime(oneMonthAgo)).toBe('last month');

        const oneYearAgo = new Date('2023-01-01T12:00:00Z');
        expect(getRelativeTime(oneYearAgo)).toBe('last year');
    });
});
