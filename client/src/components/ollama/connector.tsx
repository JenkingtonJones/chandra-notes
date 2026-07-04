import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle } from "lucide-react";

interface ConnectorProps {
  isConnected: boolean;
}

export function Connector({ isConnected }: ConnectorProps) {
  return (
    <div className="flex items-center">
      <div className={`h-3 w-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'} mr-2`}></div>
      <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
        {isConnected ? 'Connected' : 'Disconnected'}
      </span>
    </div>
  );
}
