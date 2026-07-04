
import { useState, useEffect } from "react";

type ServiceType = 'azure' | 'ollama';

export function useServiceSelector() {
  const [selectedService, setSelectedService] = useState<ServiceType>(() => {
    const saved = localStorage.getItem("selectedService");
    return (saved as ServiceType) || 'ollama';
  });

  // Function to update the service and ensure proper state change
  const updateSelectedService = (service: ServiceType) => {
    console.log(`Switching service to: ${service}`);
    setSelectedService(service);
    localStorage.setItem("selectedService", service);
  };

  // Save the selection to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem("selectedService", selectedService);
    console.log(`Current selected service: ${selectedService}`);
  }, [selectedService]);

  return {
    selectedService,
    setSelectedService: updateSelectedService,
  };
}
