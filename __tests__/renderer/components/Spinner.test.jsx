/**
 * Tests for Spinner component
 * 
 * Tests the loading spinner UI component
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import Spinner from '../../../src/renderer/components/Spinner';

describe('Spinner component', () => {
  it('should render with default size (md)', () => {
    const { container } = render(<Spinner />);
    const spinnerDiv = container.firstChild;
    
    expect(spinnerDiv).toBeInTheDocument();
    expect(spinnerDiv).toHaveClass('w-6', 'h-6', 'border-2');
  });
  
  it('should render with small size', () => {
    const { container } = render(<Spinner size="sm" />);
    const spinnerDiv = container.firstChild;
    
    expect(spinnerDiv).toHaveClass('w-4', 'h-4', 'border-2');
  });
  
  it('should render with large size', () => {
    const { container } = render(<Spinner size="lg" />);
    const spinnerDiv = container.firstChild;
    
    expect(spinnerDiv).toHaveClass('w-8', 'h-8', 'border-3');
  });
  
  it('should render with extra large size', () => {
    const { container } = render(<Spinner size="xl" />);
    const spinnerDiv = container.firstChild;
    
    expect(spinnerDiv).toHaveClass('w-12', 'h-12', 'border-4');
  });
  
  it('should apply custom className', () => {
    const { container } = render(<Spinner className="custom-class" />);
    const spinnerDiv = container.firstChild;
    
    expect(spinnerDiv).toHaveClass('custom-class');
  });
  
  it('should have animation classes', () => {
    const { container } = render(<Spinner />);
    const spinnerDiv = container.firstChild;
    
    expect(spinnerDiv).toHaveClass('animate-spin');
    expect(spinnerDiv).toHaveClass('rounded-full');
  });
  
  it('should combine size and custom className', () => {
    const { container } = render(<Spinner size="lg" className="text-blue-500" />);
    const spinnerDiv = container.firstChild;
    
    expect(spinnerDiv).toHaveClass('w-8', 'h-8', 'border-3', 'text-blue-500');
  });
});